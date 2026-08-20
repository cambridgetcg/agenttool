// Command go-cosmos-vector produces independent protobuf value-byte vectors
// from Zerone's generated Go message types. Run it from a Zerone Core checkout:
//
//	go run /path/to/agenttool/packages/zerone-agent-economy/scripts/go-cosmos-vector/main.go
//
// This helper performs no RPC, signing, broadcast, or state mutation.
package main

import (
	"crypto/sha256"
	"encoding/hex"
	"encoding/json"
	"os"

	knowledgetypes "github.com/zerone-chain/zerone/x/knowledge/types"
	sponsorshiptypes "github.com/zerone-chain/zerone/x/sponsorship/types"
	"google.golang.org/protobuf/proto"
)

const (
	workerAddress   = "zrn1w508d6qejxtdg4y5r3zarvary0c5xw7k4p057w"
	sponsorAddress  = "zrn14h0ycu78h88wzldxc7e79vhw5xsde0n8tsnt20"
	workSpecHash    = "cf342fc8052ac63419b8805f8c15273a3d7aa33ce0135af648d782ca2db7be1a"
	acceptanceHash  = "0707070707070707070707070707070707070707070707070707070707070707"
	inputRoot       = "0505050505050505050505050505050505050505050505050505050505050505"
	environmentRoot = "0606060606060606060606060606060606060606060606060606060606060606"
	artifactRoot    = "0808080808080808080808080808080808080808080808080808080808080808"
	evidenceRoot    = "0909090909090909090909090909090909090909090909090909090909090909"
	workReceiptHash = "06d1340db9038ecb4628248a8c0bf36b50da7104a0e20ee5322158459e9302b3"
	sourceWorkID    = "sha256:36479f0c7e4f43ff5f6570b0cd2023b1a9680caa3f032cfc24f98c8179d35cbe"
	parentFactID    = "commitment-UW"
)

type valueVector struct {
	Hex      string `json:"hex"`
	SHA256ID string `json:"sha256_id"`
}

type output struct {
	Protocol        string                 `json:"protocol"`
	Generator       string                 `json:"generator"`
	ConsensusHashes map[string]string      `json:"consensus_hashes"`
	Values          map[string]valueVector `json:"values"`
}

func vector(message proto.Message) valueVector {
	value, err := (proto.MarshalOptions{Deterministic: true}).Marshal(message)
	if err != nil {
		panic(err)
	}
	digest := sha256.Sum256(value)
	return valueVector{
		Hex:      hex.EncodeToString(value),
		SHA256ID: "sha256:" + hex.EncodeToString(digest[:]),
	}
}

func workContract(minCorroborations uint64) *sponsorshiptypes.WorkContract {
	return &sponsorshiptypes.WorkContract{
		WorkSpecHash:      workSpecHash,
		AcceptanceHash:    acceptanceHash,
		InputRoot:         inputRoot,
		EnvironmentRoot:   environmentRoot,
		MinCorroborations: minCorroborations,
		WorkerAddress:     workerAddress,
	}
}

func createBounty(minCorroborations uint64) *sponsorshiptypes.MsgCreateBountyOrder {
	return &sponsorshiptypes.MsgCreateBountyOrder{
		Sponsor:          sponsorAddress,
		Domain:           "computer_science",
		PricePerArtifact: "250000",
		TargetCount:      2,
		DurationBlocks:   10000,
		WorkContract:     workContract(minCorroborations),
	}
}

func main() {
	commitment := &knowledgetypes.ComputationalCommitment{
		WorkSpecHash:    workSpecHash,
		AcceptanceHash:  acceptanceHash,
		InputRoot:       inputRoot,
		EnvironmentRoot: environmentRoot,
		ArtifactRoot:    artifactRoot,
		EvidenceRoot:    evidenceRoot,
		WorkReceiptHash: workReceiptHash,
	}
	claim := &knowledgetypes.MsgSubmitClaim{
		Submitter:   workerAddress,
		FactContent: "A deterministic computation proposes one digest-bound tree transition.",
		Domain:      "computer_science",
		Category:    "computational",
		Stake:       "100000",
		Relations: []*knowledgetypes.ClaimRelation{{
			TargetFactId: parentFactID,
			Relation:     knowledgetypes.RelationType_RELATION_TYPE_REQUIRES,
		}},
		ClaimType:               knowledgetypes.ClaimType_CLAIM_TYPE_COMPUTATIONAL,
		MethodId:                "M-COMPUTATIONAL",
		ReasoningTrace:          sourceWorkID,
		ComputationalCommitment: commitment,
	}
	fulfill := &sponsorshiptypes.MsgFulfillBounty{
		Caller:   workerAddress,
		BountyId: "bounty-001",
		FactId:   "fact-001",
	}

	encoded := output{
		Protocol:  "agenttool.zerone-go-protobuf-vectors/0.1",
		Generator: "google.golang.org/protobuf + github.com/zerone-chain/zerone generated types",
		ConsensusHashes: map[string]string{
			"settlement_nullifier": sponsorshiptypes.ComputeSettlementNullifier(
				workSpecHash, acceptanceHash, inputRoot, environmentRoot, artifactRoot,
				workerAddress,
			),
		},
		Values: map[string]valueVector{
			"create_bounty_min_corroborations_0": vector(createBounty(0)),
			"create_bounty_min_corroborations_2": vector(createBounty(2)),
			"submit_computational_claim":         vector(claim),
			"fulfill_bounty":                     vector(fulfill),
		},
	}
	encoder := json.NewEncoder(os.Stdout)
	encoder.SetEscapeHTML(false)
	encoder.SetIndent("", "  ")
	if err := encoder.Encode(encoded); err != nil {
		panic(err)
	}
}
