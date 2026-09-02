// Command go-cosmos-vector independently marshals the committed creation
// bridge fixture with Zerone's generated Go protobuf types. Run from the exact
// pinned Zerone Core checkout:
//
//	go run /path/to/main.go /path/to/zerone-creation-economy-v0.1-vectors.json /path/to/output.json
//
// It performs no RPC, signing, broadcast, key, or chain operation.
package main

import (
	"crypto/sha256"
	"encoding/hex"
	"encoding/json"
	"fmt"
	"os"
	"os/exec"
	"strconv"
	"strings"

	knowledgetypes "github.com/zerone-chain/zerone/x/knowledge/types"
	sponsorshiptypes "github.com/zerone-chain/zerone/x/sponsorship/types"
	"google.golang.org/protobuf/proto"
	"google.golang.org/protobuf/types/known/anypb"
)

const pinnedZeroneCommit = "a5b82e82b2a32be2b75bd11575964b0a69aa34ac"

type workContractValue struct {
	WorkSpecHash      string `json:"work_spec_hash"`
	AcceptanceHash    string `json:"acceptance_hash"`
	InputRoot         string `json:"input_root"`
	EnvironmentRoot   string `json:"environment_root"`
	MinCorroborations string `json:"min_corroborations"`
	WorkerAddress     string `json:"worker_address"`
}

type createBountyValue struct {
	Sponsor          string            `json:"sponsor"`
	Domain           string            `json:"domain"`
	PricePerArtifact string            `json:"price_per_artifact"`
	TargetCount      uint32            `json:"target_count"`
	DurationBlocks   string            `json:"duration_blocks"`
	WorkContract     workContractValue `json:"work_contract"`
}

type relationValue struct {
	TargetFactID         string `json:"target_fact_id"`
	Relation             int32  `json:"relation"`
	Inference            int32  `json:"inference"`
	InferenceStrengthBPS string `json:"inference_strength_bps"`
	MethodID             string `json:"method_id"`
}

type commitmentValue struct {
	WorkSpecHash    string `json:"work_spec_hash"`
	AcceptanceHash  string `json:"acceptance_hash"`
	InputRoot       string `json:"input_root"`
	EnvironmentRoot string `json:"environment_root"`
	ArtifactRoot    string `json:"artifact_root"`
	EvidenceRoot    string `json:"evidence_root"`
	WorkReceiptHash string `json:"work_receipt_hash"`
}

type submitClaimValue struct {
	Submitter               string          `json:"submitter"`
	FactContent             string          `json:"fact_content"`
	Domain                  string          `json:"domain"`
	Category                string          `json:"category"`
	Stake                   string          `json:"stake"`
	References              []string        `json:"references"`
	PartnershipID           string          `json:"partnership_id"`
	ClaimType               int32           `json:"claim_type"`
	Relations               []relationValue `json:"relations"`
	Structure               json.RawMessage `json:"structure"`
	CanonicalForm           string          `json:"canonical_form"`
	Sponsored               bool            `json:"sponsored"`
	MethodID                string          `json:"method_id"`
	ReasoningTrace          string          `json:"reasoning_trace"`
	ComputationalCommitment commitmentValue `json:"computational_commitment"`
}

type messageValue struct {
	TypeURL string          `json:"type_url"`
	Value   json.RawMessage `json:"value"`
}

type handoffInput struct {
	Messages struct {
		CreateBounty messageValue `json:"create_bounty"`
		SubmitClaim  messageValue `json:"submit_claim"`
	} `json:"messages"`
}

type fixtureCase struct {
	Handoff handoffInput `json:"handoff"`
}

type inputVector struct {
	SourcePins struct {
		ZeroneCoreCommit string `json:"zerone_core_commit"`
	} `json:"source_pins"`
	Handoff           handoffInput `json:"handoff"`
	DefensiveSecurity fixtureCase  `json:"defensive_security"`
}

type encodedVector struct {
	Hex      string `json:"hex"`
	SHA256ID string `json:"sha256_id"`
}

type outputVector struct {
	Protocol          string                   `json:"protocol"`
	Generator         string                   `json:"generator"`
	GeneratorEvidence map[string]string        `json:"generator_evidence"`
	SourcePins        map[string]string        `json:"source_pins"`
	Consensus         map[string]string        `json:"consensus_hashes"`
	Values            map[string]encodedVector `json:"values"`
}

type preparedCase struct {
	Create        *sponsorshiptypes.MsgCreateBountyOrder
	Submit        *knowledgetypes.MsgSubmitClaim
	CreateTypeURL string
	SubmitTypeURL string
	WorkReceipt   string
}

func mustUint64(value, path string) uint64 {
	parsed, err := strconv.ParseUint(value, 10, 64)
	if err != nil || strconv.FormatUint(parsed, 10) != value {
		panic(fmt.Sprintf("%s is not a canonical uint64", path))
	}
	return parsed
}

func marshal(message proto.Message) ([]byte, encodedVector) {
	value, err := (proto.MarshalOptions{Deterministic: true}).Marshal(message)
	if err != nil {
		panic(err)
	}
	digest := sha256.Sum256(value)
	return value, encodedVector{
		Hex:      hex.EncodeToString(value),
		SHA256ID: "sha256:" + hex.EncodeToString(digest[:]),
	}
}

func anyVector(typeURL string, value []byte) encodedVector {
	_, encoded := marshal(&anypb.Any{TypeUrl: typeURL, Value: value})
	return encoded
}

func gitOutput(arguments ...string) string {
	command := exec.Command("git", arguments...)
	output, err := command.Output()
	if err != nil {
		panic(fmt.Sprintf("git %s failed: %v", strings.Join(arguments, " "), err))
	}
	return strings.TrimSpace(string(output))
}

func verifyCheckout() map[string]string {
	root := gitOutput("rev-parse", "--show-toplevel")
	head := gitOutput("-C", root, "rev-parse", "HEAD")
	if head != pinnedZeroneCommit {
		panic("generator is not running from the pinned Zerone checkout")
	}
	goMod, err := os.ReadFile(root + "/go.mod")
	if err != nil {
		panic(err)
	}
	if !strings.HasPrefix(string(goMod), "module github.com/zerone-chain/zerone\n") {
		panic("generator working tree is not the Zerone module")
	}
	relevantStatus := gitOutput(
		"-C", root,
		"status", "--porcelain=v1", "--untracked-files=all", "--ignored=matching", "--",
		"go.mod", "go.sum", "x/knowledge/types", "x/sponsorship/types",
	)
	if relevantStatus != "" {
		panic("pinned Zerone protobuf or receipt sources differ from Git HEAD")
	}
	return map[string]string{
		"zerone_git_head":        head,
		"zerone_module":          "github.com/zerone-chain/zerone",
		"relevant_source_status": "head_exact_no_changes_or_extra_files",
	}
}

func prepareCase(input handoffInput, label string) preparedCase {
	var createValue createBountyValue
	if err := json.Unmarshal(input.Messages.CreateBounty.Value, &createValue); err != nil {
		panic(fmt.Sprintf("%s create-bounty value: %v", label, err))
	}
	if input.Messages.CreateBounty.TypeURL != "/zerone.sponsorship.v1.MsgCreateBountyOrder" {
		panic(fmt.Sprintf("%s has an unexpected create-bounty type URL", label))
	}
	create := &sponsorshiptypes.MsgCreateBountyOrder{
		Sponsor:          createValue.Sponsor,
		Domain:           createValue.Domain,
		PricePerArtifact: createValue.PricePerArtifact,
		TargetCount:      createValue.TargetCount,
		DurationBlocks:   mustUint64(createValue.DurationBlocks, label+".duration_blocks"),
		WorkContract: &sponsorshiptypes.WorkContract{
			WorkSpecHash:      createValue.WorkContract.WorkSpecHash,
			AcceptanceHash:    createValue.WorkContract.AcceptanceHash,
			InputRoot:         createValue.WorkContract.InputRoot,
			EnvironmentRoot:   createValue.WorkContract.EnvironmentRoot,
			MinCorroborations: mustUint64(createValue.WorkContract.MinCorroborations, label+".min_corroborations"),
			WorkerAddress:     createValue.WorkContract.WorkerAddress,
		},
	}

	var submitValue submitClaimValue
	if err := json.Unmarshal(input.Messages.SubmitClaim.Value, &submitValue); err != nil {
		panic(fmt.Sprintf("%s submit-claim value: %v", label, err))
	}
	if input.Messages.SubmitClaim.TypeURL != "/zerone.knowledge.v1.MsgSubmitClaim" {
		panic(fmt.Sprintf("%s has an unexpected submit-claim type URL", label))
	}
	if len(submitValue.References) != 0 || string(submitValue.Structure) != "null" {
		panic(fmt.Sprintf("%s unexpectedly widened references or structure", label))
	}
	relations := make([]*knowledgetypes.ClaimRelation, len(submitValue.Relations))
	for index, relation := range submitValue.Relations {
		relations[index] = &knowledgetypes.ClaimRelation{
			TargetFactId:         relation.TargetFactID,
			Relation:             knowledgetypes.RelationType(relation.Relation),
			Inference:            knowledgetypes.InferenceType(relation.Inference),
			InferenceStrengthBps: mustUint64(relation.InferenceStrengthBPS, label+".inference_strength_bps"),
			MethodId:             relation.MethodID,
		}
	}
	commitment := &knowledgetypes.ComputationalCommitment{
		WorkSpecHash:    submitValue.ComputationalCommitment.WorkSpecHash,
		AcceptanceHash:  submitValue.ComputationalCommitment.AcceptanceHash,
		InputRoot:       submitValue.ComputationalCommitment.InputRoot,
		EnvironmentRoot: submitValue.ComputationalCommitment.EnvironmentRoot,
		ArtifactRoot:    submitValue.ComputationalCommitment.ArtifactRoot,
		EvidenceRoot:    submitValue.ComputationalCommitment.EvidenceRoot,
		WorkReceiptHash: submitValue.ComputationalCommitment.WorkReceiptHash,
	}
	if computed := knowledgetypes.ComputeWorkReceiptHash(commitment, submitValue.Submitter); computed != commitment.WorkReceiptHash {
		panic(fmt.Sprintf("%s work receipt does not match Zerone consensus derivation", label))
	}
	submit := &knowledgetypes.MsgSubmitClaim{
		Submitter:               submitValue.Submitter,
		FactContent:             submitValue.FactContent,
		Domain:                  submitValue.Domain,
		Category:                submitValue.Category,
		Stake:                   submitValue.Stake,
		References:              submitValue.References,
		PartnershipId:           submitValue.PartnershipID,
		ClaimType:               knowledgetypes.ClaimType(submitValue.ClaimType),
		Relations:               relations,
		CanonicalForm:           submitValue.CanonicalForm,
		Sponsored:               submitValue.Sponsored,
		MethodId:                submitValue.MethodID,
		ReasoningTrace:          submitValue.ReasoningTrace,
		ComputationalCommitment: commitment,
	}
	return preparedCase{
		Create:        create,
		Submit:        submit,
		CreateTypeURL: input.Messages.CreateBounty.TypeURL,
		SubmitTypeURL: input.Messages.SubmitClaim.TypeURL,
		WorkReceipt:   commitment.WorkReceiptHash,
	}
}

func main() {
	if len(os.Args) != 3 {
		panic("usage: go-cosmos-vector INPUT_VECTOR OUTPUT_VECTOR")
	}
	inputBytes, err := os.ReadFile(os.Args[1])
	if err != nil {
		panic(err)
	}
	var input inputVector
	if err := json.Unmarshal(inputBytes, &input); err != nil {
		panic(err)
	}
	if input.SourcePins.ZeroneCoreCommit != pinnedZeroneCommit {
		panic("input vector is not pinned to the reviewed Zerone commit")
	}
	generatorEvidence := verifyCheckout()

	formal := prepareCase(input.Handoff, "formal")
	defensiveSecurity := prepareCase(input.DefensiveSecurity.Handoff, "defensive_security")
	formalCreateBytes, formalCreateEncoded := marshal(formal.Create)
	formalSubmitBytes, formalSubmitEncoded := marshal(formal.Submit)
	defensiveCreateBytes, defensiveCreateEncoded := marshal(defensiveSecurity.Create)
	defensiveSubmitBytes, defensiveSubmitEncoded := marshal(defensiveSecurity.Submit)
	output := outputVector{
		Protocol:          "agenttool.zerone-creation-economy-go-vectors/0.1",
		Generator:         "google.golang.org/protobuf + github.com/zerone-chain/zerone generated types",
		GeneratorEvidence: generatorEvidence,
		SourcePins: map[string]string{
			"zerone_core_commit": pinnedZeroneCommit,
		},
		Consensus: map[string]string{
			"work_receipt_hash":                    formal.WorkReceipt,
			"defensive_security_work_receipt_hash": defensiveSecurity.WorkReceipt,
		},
		Values: map[string]encodedVector{
			"create_bounty_value": formalCreateEncoded,
			"create_bounty_any": anyVector(
				formal.CreateTypeURL,
				formalCreateBytes,
			),
			"submit_claim_value": formalSubmitEncoded,
			"submit_claim_any": anyVector(
				formal.SubmitTypeURL,
				formalSubmitBytes,
			),
			"defensive_security_create_bounty_value": defensiveCreateEncoded,
			"defensive_security_create_bounty_any": anyVector(
				defensiveSecurity.CreateTypeURL,
				defensiveCreateBytes,
			),
			"defensive_security_submit_claim_value": defensiveSubmitEncoded,
			"defensive_security_submit_claim_any": anyVector(
				defensiveSecurity.SubmitTypeURL,
				defensiveSubmitBytes,
			),
		},
	}
	rendered, err := json.MarshalIndent(output, "", "  ")
	if err != nil {
		panic(err)
	}
	rendered = append(rendered, '\n')
	if err := os.WriteFile(os.Args[2], rendered, 0o644); err != nil {
		panic(err)
	}
}
