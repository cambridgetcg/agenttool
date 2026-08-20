// Command wallet-zerone-economy-fixture emits independent Cosmos SDK wire
// vectors for the source-only Zerone economy planner.
//
// Run from zerone-core commit a5b82e82b2a32be2b75bd11575964b0a69aa34ac.
// It uses that tree's generated messages, Cosmos transaction types, secp256k1
// implementation, and exported gas constants. It performs no RPC or mutation.
package main

import (
	"bytes"
	"crypto/sha256"
	"encoding/base64"
	"encoding/hex"
	"encoding/json"
	"fmt"
	"go/ast"
	"go/parser"
	"go/token"
	"os"
	"strconv"
	"strings"

	"github.com/cosmos/cosmos-sdk/codec/types"
	"github.com/cosmos/cosmos-sdk/crypto/keys/secp256k1"
	sdk "github.com/cosmos/cosmos-sdk/types"
	txtypes "github.com/cosmos/cosmos-sdk/types/tx"
	signing "github.com/cosmos/cosmos-sdk/types/tx/signing"
	authtypes "github.com/cosmos/cosmos-sdk/x/auth/types"
	gogoproto "github.com/cosmos/gogoproto/proto"
	"github.com/zerone-chain/zerone/app"
	knowledgetypes "github.com/zerone-chain/zerone/x/knowledge/types"
	sponsorshiptypes "github.com/zerone-chain/zerone/x/sponsorship/types"
	"google.golang.org/protobuf/proto"
)

const (
	coreCommit      = "a5b82e82b2a32be2b75bd11575964b0a69aa34ac"
	cosmosSDK       = "v0.53.8"
	chainID         = "zerone-testnet-1"
	accountNumber   = uint64(7)
	sequence        = uint64(9)
	createGas       = uint64(22_222)
	submitClaimGas  = uint64(100_000)
	fulfillGas      = uint64(22_222)
	gasLimit        = createGas + submitClaimGas + fulfillGas
	feeAmount       = gasLimit
	workSpecHash    = "cf342fc8052ac63419b8805f8c15273a3d7aa33ce0135af648d782ca2db7be1a"
	acceptanceHash  = "0707070707070707070707070707070707070707070707070707070707070707"
	inputRoot       = "0505050505050505050505050505050505050505050505050505050505050505"
	environmentRoot = "0606060606060606060606060606060606060606060606060606060606060606"
	artifactRoot    = "0808080808080808080808080808080808080808080808080808080808080808"
	evidenceRoot    = "0909090909090909090909090909090909090909090909090909090909090909"
	workReceiptHash = "06d1340db9038ecb4628248a8c0bf36b50da7104a0e20ee5322158459e9302b3"
)

type messageVector struct {
	TypeURL   string `json:"type_url"`
	ValueB64U string `json:"value_b64u"`
	ValueHash string `json:"value_sha256_id"`
	AnyB64U   string `json:"any_b64u"`
}

type directSignVector struct {
	BodyBytesB64U         string `json:"body_bytes_b64u"`
	AuthInfoBytesB64U     string `json:"auth_info_bytes_b64u"`
	SignDocBytesB64U      string `json:"sign_doc_bytes_b64u"`
	SimulationTxBytesB64U string `json:"simulation_tx_bytes_b64u"`
	SignatureB64U         string `json:"signature_b64u"`
	SignedTxBytesB64U     string `json:"signed_tx_bytes_b64u"`
	TxHash                string `json:"tx_hash"`
}

type singleMessagePlanVector struct {
	RequiredGas       string           `json:"required_gas"`
	ReservedSpendUZRN string           `json:"reserved_spend_uzrn"`
	DirectSign        directSignVector `json:"direct_sign"`
}

type output struct {
	Schema     string `json:"schema"`
	Provenance struct {
		Generator        string `json:"generator"`
		ZeroneCoreCommit string `json:"zerone_core_commit"`
		CosmosSDK        string `json:"cosmos_sdk"`
		GasSource        string `json:"gas_source"`
	} `json:"provenance"`
	FixtureBoundary struct {
		BundlePurpose                        string `json:"bundle_purpose"`
		BundleSameTransactionLifecycleViable bool   `json:"bundle_same_transaction_lifecycle_viable"`
		OrdinaryExecutionShape               string `json:"ordinary_execution_shape"`
		MultiMessageRequirement              string `json:"multi_message_requirement"`
	} `json:"fixture_boundary"`
	Profile struct {
		ChainReference           string `json:"chain_reference"`
		AccountNumber            string `json:"account_number"`
		Sequence                 string `json:"sequence"`
		GasLimit                 string `json:"gas_limit"`
		FeeAmountUZRN            string `json:"fee_amount_uzrn"`
		SourceAddress            string `json:"source_address"`
		PublicKeyB64U            string `json:"public_key_b64u"`
		SponsorshipModuleAddress string `json:"sponsorship_module_address"`
		KnowledgeModuleAddress   string `json:"knowledge_module_address"`
	} `json:"profile"`
	Gas struct {
		MinGasLimit          string `json:"min_gas_limit"`
		CreateBounty         string `json:"create_bounty"`
		SubmitClaim          string `json:"submit_claim"`
		FulfillBounty        string `json:"fulfill_bounty"`
		RequiredOrderedTotal string `json:"required_ordered_total"`
		MaxTxGas             string `json:"max_tx_gas"`
		MinGasPriceUZRN      string `json:"min_gas_price_uzrn"`
	} `json:"gas"`
	Messages struct {
		CreateBounty  messageVector `json:"create_bounty"`
		SubmitClaim   messageVector `json:"submit_claim"`
		FulfillBounty messageVector `json:"fulfill_bounty"`
	} `json:"messages"`
	DirectSign         directSignVector `json:"direct_sign"`
	SingleMessagePlans struct {
		CreateBounty  singleMessagePlanVector `json:"create_bounty"`
		SubmitClaim   singleMessagePlanVector `json:"submit_claim"`
		FulfillBounty singleMessagePlanVector `json:"fulfill_bounty"`
	} `json:"single_message_plans"`
	Verified struct {
		MessageRoundTrips             bool `json:"message_round_trips"`
		BodyRoundTrip                 bool `json:"body_round_trip"`
		AuthInfoRoundTrip             bool `json:"auth_info_round_trip"`
		SignDocRoundTrip              bool `json:"sign_doc_round_trip"`
		SimulationTxRoundTrip         bool `json:"simulation_tx_round_trip"`
		SignedTxRoundTrip             bool `json:"signed_tx_round_trip"`
		OneEmptySimulationSignature   bool `json:"one_empty_simulation_signature"`
		CosmosSecpVerifySignature     bool `json:"cosmos_secp_verify_signature"`
		ExportedGasConstantsMatch     bool `json:"exported_gas_constants_match"`
		CandidateMessageGasTableMatch bool `json:"candidate_message_gas_table_match"`
	} `json:"verified"`
}

func must(err error) {
	if err != nil {
		panic(err)
	}
}

func mustBytes(value []byte, err error) []byte {
	must(err)
	return value
}

func b64u(value []byte) string { return base64.RawURLEncoding.EncodeToString(value) }

func exact(label string, left, right []byte) {
	if !bytes.Equal(left, right) {
		panic(fmt.Sprintf("%s failed exact unmarshal/re-marshal", label))
	}
}

type chainMessage interface {
	proto.Message
	gogoproto.Message
}

func mustAny(message gogoproto.Message) *types.Any {
	value, err := types.NewAnyWithValue(message)
	must(err)
	return value
}

func vector(message chainMessage) (messageVector, *types.Any) {
	value := mustBytes(proto.MarshalOptions{Deterministic: true}.Marshal(message))
	any := mustAny(message)
	exact("Any.value", value, any.Value)
	anyBytes := mustBytes(any.Marshal())
	digest := sha256.Sum256(value)
	return messageVector{
		TypeURL:   any.TypeUrl,
		ValueB64U: b64u(value),
		ValueHash: "sha256:" + hex.EncodeToString(digest[:]),
		AnyB64U:   b64u(anyBytes),
	}, any
}

func directSignFixture(
	label string,
	privateKey *secp256k1.PrivKey,
	publicKey *secp256k1.PubKey,
	messages []*types.Any,
	requiredGas uint64,
) directSignVector {
	body := &txtypes.TxBody{Messages: messages}
	bodyBytes := mustBytes(body.Marshal())
	var decodedBody txtypes.TxBody
	must(decodedBody.Unmarshal(bodyBytes))
	exact(label+" TxBody", bodyBytes, mustBytes(decodedBody.Marshal()))

	publicKeyAny := mustAny(publicKey)
	authInfo := &txtypes.AuthInfo{
		SignerInfos: []*txtypes.SignerInfo{{
			PublicKey: publicKeyAny,
			ModeInfo: &txtypes.ModeInfo{Sum: &txtypes.ModeInfo_Single_{
				Single: &txtypes.ModeInfo_Single{Mode: signing.SignMode_SIGN_MODE_DIRECT},
			}},
			Sequence: sequence,
		}},
		Fee: &txtypes.Fee{
			Amount:   sdk.NewCoins(sdk.NewInt64Coin("uzrn", int64(requiredGas))),
			GasLimit: requiredGas,
		},
	}
	authInfoBytes := mustBytes(authInfo.Marshal())
	var decodedAuthInfo txtypes.AuthInfo
	must(decodedAuthInfo.Unmarshal(authInfoBytes))
	exact(label+" AuthInfo", authInfoBytes, mustBytes(decodedAuthInfo.Marshal()))

	signDoc := &txtypes.SignDoc{
		BodyBytes:     bodyBytes,
		AuthInfoBytes: authInfoBytes,
		ChainId:       chainID,
		AccountNumber: accountNumber,
	}
	signDocBytes := mustBytes(signDoc.Marshal())
	var decodedSignDoc txtypes.SignDoc
	must(decodedSignDoc.Unmarshal(signDocBytes))
	exact(label+" SignDoc", signDocBytes, mustBytes(decodedSignDoc.Marshal()))

	simulationTx := &txtypes.TxRaw{
		BodyBytes:     bodyBytes,
		AuthInfoBytes: authInfoBytes,
		Signatures:    [][]byte{{}},
	}
	simulationTxBytes := mustBytes(simulationTx.Marshal())
	var decodedSimulationTx txtypes.TxRaw
	must(decodedSimulationTx.Unmarshal(simulationTxBytes))
	exact(label+" simulation TxRaw", simulationTxBytes, mustBytes(decodedSimulationTx.Marshal()))
	if len(decodedSimulationTx.Signatures) != 1 || len(decodedSimulationTx.Signatures[0]) != 0 {
		panic(label + " simulation TxRaw must contain exactly one empty signature")
	}

	signature := mustBytes(privateKey.Sign(signDocBytes))
	if len(signature) != 64 || !publicKey.VerifySignature(signDocBytes, signature) {
		panic(label + " Cosmos secp256k1 fixture signature failed")
	}
	signedTx := &txtypes.TxRaw{
		BodyBytes:     bodyBytes,
		AuthInfoBytes: authInfoBytes,
		Signatures:    [][]byte{signature},
	}
	signedTxBytes := mustBytes(signedTx.Marshal())
	var decodedSignedTx txtypes.TxRaw
	must(decodedSignedTx.Unmarshal(signedTxBytes))
	exact(label+" signed TxRaw", signedTxBytes, mustBytes(decodedSignedTx.Marshal()))
	txHash := sha256.Sum256(signedTxBytes)

	return directSignVector{
		BodyBytesB64U:         b64u(bodyBytes),
		AuthInfoBytesB64U:     b64u(authInfoBytes),
		SignDocBytesB64U:      b64u(signDocBytes),
		SimulationTxBytesB64U: b64u(simulationTxBytes),
		SignatureB64U:         b64u(signature),
		SignedTxBytesB64U:     b64u(signedTxBytes),
		TxHash:                strings.ToUpper(hex.EncodeToString(txHash[:])),
	}
}

func stringMapKeys(filename string, variable string) map[string]bool {
	file, err := parser.ParseFile(token.NewFileSet(), filename, nil, 0)
	must(err)
	var literal *ast.CompositeLit
	ast.Inspect(file, func(node ast.Node) bool {
		spec, ok := node.(*ast.ValueSpec)
		if !ok {
			return true
		}
		for index, name := range spec.Names {
			if name.Name == variable && index < len(spec.Values) {
				literal, _ = spec.Values[index].(*ast.CompositeLit)
				return false
			}
		}
		return true
	})
	if literal == nil {
		panic(fmt.Sprintf("%s does not define composite map %s", filename, variable))
	}
	keys := make(map[string]bool, len(literal.Elts))
	for _, element := range literal.Elts {
		pair, ok := element.(*ast.KeyValueExpr)
		if !ok {
			panic(variable + " contains a non-keyed element")
		}
		basic, ok := pair.Key.(*ast.BasicLit)
		if !ok || basic.Kind != token.STRING {
			panic(variable + " contains a non-string key")
		}
		key, err := strconv.Unquote(basic.Value)
		must(err)
		keys[key] = true
	}
	return keys
}

func main() {
	if len(os.Args) != 2 {
		panic("usage: wallet-zerone-economy-fixture <output-json>")
	}
	privateKeyBytes := make([]byte, 32)
	privateKeyBytes[31] = 1 // Public deterministic fixture key; never use it.
	privateKey := &secp256k1.PrivKey{Key: privateKeyBytes}
	publicKey := privateKey.PubKey().(*secp256k1.PubKey)
	sourceAddress := sdk.AccAddress(publicKey.Address()).String()

	workContract := &sponsorshiptypes.WorkContract{
		WorkSpecHash:      workSpecHash,
		AcceptanceHash:    acceptanceHash,
		InputRoot:         inputRoot,
		EnvironmentRoot:   environmentRoot,
		MinCorroborations: 2,
		WorkerAddress:     sourceAddress,
	}
	create := &sponsorshiptypes.MsgCreateBountyOrder{
		Sponsor:          sourceAddress,
		Domain:           "computer_science",
		PricePerArtifact: "250000",
		TargetCount:      2,
		DurationBlocks:   10000,
		WorkContract:     workContract,
	}
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
		Submitter:   sourceAddress,
		FactContent: "A deterministic computation proposes one digest-bound tree transition.",
		Domain:      "computer_science",
		Category:    "computational",
		Stake:       "100000",
		References:  []string{"prior-fact"},
		ClaimType:   knowledgetypes.ClaimType_CLAIM_TYPE_COMPUTATIONAL,
		Relations: []*knowledgetypes.ClaimRelation{{
			TargetFactId: "prior-fact",
			Relation:     knowledgetypes.RelationType_RELATION_TYPE_REQUIRES,
		}},
		MethodId:                "M-COMPUTATIONAL",
		ReasoningTrace:          "sha256:36479f0c7e4f43ff5f6570b0cd2023b1a9680caa3f032cfc24f98c8179d35cbe",
		ComputationalCommitment: commitment,
	}
	fulfill := &sponsorshiptypes.MsgFulfillBounty{
		Caller:   sourceAddress,
		BountyId: "bounty-001",
		FactId:   "fact-001",
	}

	createVector, createAny := vector(create)
	claimVector, claimAny := vector(claim)
	fulfillVector, fulfillAny := vector(fulfill)
	bundleDirect := directSignFixture(
		"ordered parity bundle",
		privateKey,
		publicKey,
		[]*types.Any{createAny, claimAny, fulfillAny},
		gasLimit,
	)
	createDirect := directSignFixture(
		"single CreateBountyOrder",
		privateKey,
		publicKey,
		[]*types.Any{createAny},
		createGas,
	)
	claimDirect := directSignFixture(
		"single SubmitClaim",
		privateKey,
		publicKey,
		[]*types.Any{claimAny},
		submitClaimGas,
	)
	fulfillDirect := directSignFixture(
		"single FulfillBounty",
		privateKey,
		publicKey,
		[]*types.Any{fulfillAny},
		fulfillGas,
	)

	messageGasKeys := stringMapKeys("app/ante_zerone.go", "msgTypeURLToGas")
	messageGasTableMatch := !messageGasKeys[createVector.TypeURL] &&
		messageGasKeys[claimVector.TypeURL] &&
		!messageGasKeys[fulfillVector.TypeURL]
	gasMatch := messageGasTableMatch && app.MinGasLimit == createGas &&
		app.TransactionGasCosts["claim_submit"] == submitClaimGas &&
		app.EstimateTransactionGas("wallet_zerone_economy_unmapped") == fulfillGas &&
		app.TxGasLimit == 11_111_111 && app.MinGasPrice == 1
	if !gasMatch {
		panic("exported Zerone gas constants no longer match the candidate planner")
	}

	var result output
	result.Schema = "agent-wallet-zerone-economy.go-cosmos-vectors/0.1"
	result.Provenance.Generator = "packages/wallet-zerone-economy/scripts/go-cosmos-fixture/main.go"
	result.Provenance.ZeroneCoreCommit = coreCommit
	result.Provenance.CosmosSDK = cosmosSDK
	result.Provenance.GasSource = "app/gas.go + app/ante_zerone.go"
	result.FixtureBoundary.BundlePurpose = "byte_order_and_parity_only"
	result.FixtureBoundary.BundleSameTransactionLifecycleViable = false
	result.FixtureBoundary.OrdinaryExecutionShape = "one_lifecycle_message_per_plan"
	result.FixtureBoundary.MultiMessageRequirement = "independently_valid_combination_and_successful_exact_simulation"
	result.Profile.ChainReference = chainID
	result.Profile.AccountNumber = fmt.Sprint(accountNumber)
	result.Profile.Sequence = fmt.Sprint(sequence)
	result.Profile.GasLimit = fmt.Sprint(gasLimit)
	result.Profile.FeeAmountUZRN = fmt.Sprint(feeAmount)
	result.Profile.SourceAddress = sourceAddress
	result.Profile.PublicKeyB64U = b64u(publicKey.Bytes())
	result.Profile.SponsorshipModuleAddress = authtypes.NewModuleAddress("sponsorship").String()
	result.Profile.KnowledgeModuleAddress = authtypes.NewModuleAddress("knowledge").String()
	result.Gas.MinGasLimit = fmt.Sprint(app.MinGasLimit)
	result.Gas.CreateBounty = fmt.Sprint(createGas)
	result.Gas.SubmitClaim = fmt.Sprint(submitClaimGas)
	result.Gas.FulfillBounty = fmt.Sprint(fulfillGas)
	result.Gas.RequiredOrderedTotal = fmt.Sprint(gasLimit)
	result.Gas.MaxTxGas = fmt.Sprint(app.TxGasLimit)
	result.Gas.MinGasPriceUZRN = fmt.Sprint(app.MinGasPrice)
	result.Messages.CreateBounty = createVector
	result.Messages.SubmitClaim = claimVector
	result.Messages.FulfillBounty = fulfillVector
	result.DirectSign = bundleDirect
	result.SingleMessagePlans.CreateBounty = singleMessagePlanVector{
		RequiredGas:       fmt.Sprint(createGas),
		ReservedSpendUZRN: "500000",
		DirectSign:        createDirect,
	}
	result.SingleMessagePlans.SubmitClaim = singleMessagePlanVector{
		RequiredGas:       fmt.Sprint(submitClaimGas),
		ReservedSpendUZRN: "100000",
		DirectSign:        claimDirect,
	}
	result.SingleMessagePlans.FulfillBounty = singleMessagePlanVector{
		RequiredGas:       fmt.Sprint(fulfillGas),
		ReservedSpendUZRN: "0",
		DirectSign:        fulfillDirect,
	}
	result.Verified.MessageRoundTrips = true
	result.Verified.BodyRoundTrip = true
	result.Verified.AuthInfoRoundTrip = true
	result.Verified.SignDocRoundTrip = true
	result.Verified.SimulationTxRoundTrip = true
	result.Verified.SignedTxRoundTrip = true
	result.Verified.OneEmptySimulationSignature = true
	result.Verified.CosmosSecpVerifySignature = true
	result.Verified.ExportedGasConstantsMatch = gasMatch
	result.Verified.CandidateMessageGasTableMatch = messageGasTableMatch

	encoded, err := json.MarshalIndent(result, "", "  ")
	must(err)
	encoded = append(encoded, '\n')
	must(os.WriteFile(os.Args[1], encoded, 0o644))
}
