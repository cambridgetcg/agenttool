// Command wallet-zerone-fixture generates independent Cosmos SDK wire
// fixtures for @agenttool/wallet-zerone.
//
// Run this source from the root of zerone-core commit
// 35284a22192df8fc6273135f14e8549c804778b6. The package wrapper script
// performs that checkout and pins Cosmos SDK v0.50.15 through zerone-core's
// go.mod. This command deliberately uses the chain's generated protobuf types,
// keeper.ComputeLinkHash, and Cosmos secp256k1 implementation rather than any
// TypeScript adapter code.
package main

import (
	"bytes"
	"crypto/sha256"
	"encoding/base64"
	"encoding/hex"
	"encoding/json"
	"fmt"
	"os"
	"strings"

	"github.com/cosmos/cosmos-sdk/codec/types"
	"github.com/cosmos/cosmos-sdk/crypto/keys/secp256k1"
	sdk "github.com/cosmos/cosmos-sdk/types"
	txtypes "github.com/cosmos/cosmos-sdk/types/tx"
	signing "github.com/cosmos/cosmos-sdk/types/tx/signing"
	banktypes "github.com/cosmos/cosmos-sdk/x/bank/types"
	"github.com/zerone-chain/zerone/x/substrate_bridge/keeper"
	substratebridgetypes "github.com/zerone-chain/zerone/x/substrate_bridge/types"
	"google.golang.org/protobuf/proto"
)

const (
	zeroneCoreCommit = "35284a22192df8fc6273135f14e8549c804778b6"
	cosmosSDKVersion = "v0.50.15"
	adapterID        = "agenttool-invocation-v1"
	workClassID      = "agenttool.invocation"
	chainID          = "zerone-testnet-1"
	sourceID         = "11111111-1111-4111-8111-111111111111"
	sourceURL        = "https://api.agenttool.dev/v1/invocations/" + sourceID
)

type invocationProjection struct {
	Amount        int64   `json:"amount"`
	BuyerDID      string  `json:"buyer_did"`
	CompletedAt   *string `json:"completed_at"`
	CompletionSig *string `json:"completion_sig"`
	CreatedAt     string  `json:"created_at"`
	Currency      string  `json:"currency"`
	ID            string  `json:"id"`
	ListingID     string  `json:"listing_id"`
	SettledAt     *string `json:"settled_at"`
	Status        string  `json:"status"`
}

type vector struct {
	Schema     string `json:"schema"`
	Provenance struct {
		Generator        string `json:"generator"`
		ZeroneCoreCommit string `json:"zerone_core_commit"`
		CosmosSDK        string `json:"cosmos_sdk"`
	} `json:"provenance"`
	Profile struct {
		ChainReference   string `json:"chain_reference"`
		AccountNumber    string `json:"account_number"`
		Sequence         string `json:"sequence"`
		GasLimit         string `json:"gas_limit"`
		FeeAmountUZRN    string `json:"fee_amount_uzrn"`
		SourceAddress    string `json:"source_address"`
		RecipientAddress string `json:"recipient_address"`
		PublicKeyB64U    string `json:"public_key_b64u"`
	} `json:"profile"`
	Invocation struct {
		Projection           invocationProjection `json:"projection"`
		CanonicalBytesB64U   string               `json:"canonical_bytes_b64u"`
		ContentHashHex       string               `json:"content_hash_hex"`
		LinkHashHex          string               `json:"link_hash_hex"`
		AttestationValueB64U string               `json:"attestation_value_b64u"`
		MsgSendValueB64U     string               `json:"msg_send_value_b64u"`
	} `json:"invocation"`
	DirectSign struct {
		BodyBytesB64U         string `json:"body_bytes_b64u"`
		AuthInfoBytesB64U     string `json:"auth_info_bytes_b64u"`
		SignDocBytesB64U      string `json:"sign_doc_bytes_b64u"`
		SimulationTxBytesB64U string `json:"simulation_tx_bytes_b64u"`
		SignatureB64U         string `json:"signature_b64u"`
		SignedTxBytesB64U     string `json:"signed_tx_bytes_b64u"`
		TxHash                string `json:"tx_hash"`
	} `json:"direct_sign"`
	Verified struct {
		GeneratedMessageRoundTrip bool `json:"generated_message_round_trip"`
		BodyRoundTrip             bool `json:"body_round_trip"`
		AuthInfoRoundTrip         bool `json:"auth_info_round_trip"`
		SignDocRoundTrip          bool `json:"sign_doc_round_trip"`
		SimulationTxRoundTrip     bool `json:"simulation_tx_round_trip"`
		SignedTxRoundTrip         bool `json:"signed_tx_round_trip"`
		OneEmptySimulationSig     bool `json:"one_empty_simulation_signature"`
		CosmosSecpVerifySignature bool `json:"cosmos_secp_verify_signature"`
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

func b64u(value []byte) string {
	return base64.RawURLEncoding.EncodeToString(value)
}

func hexLower(value []byte) string {
	return hex.EncodeToString(value)
}

func exact(label string, left, right []byte) {
	if !bytes.Equal(left, right) {
		panic(fmt.Sprintf("%s failed byte-identical unmarshal/re-marshal", label))
	}
}

func main() {
	if len(os.Args) != 2 {
		panic("usage: wallet-zerone-fixture <output-json>")
	}

	config := sdk.GetConfig()
	config.SetBech32PrefixForAccount("zrn", "zrnpub")

	testTimeCompleted := "2026-07-05T21:58:00Z"
	testCompletionSig := "Y29tcGxldGlvbi1zaWduYXR1cmU="
	testTimeSettled := "2026-07-05T22:00:00Z"
	invocation := invocationProjection{
		Amount:        53,
		BuyerDID:      "did:at:buyer-fixture",
		CompletedAt:   &testTimeCompleted,
		CompletionSig: &testCompletionSig,
		CreatedAt:     "2026-07-05T21:00:00Z",
		Currency:      "USD",
		ID:            sourceID,
		ListingID:     "22222222-2222-4222-8222-222222222222",
		SettledAt:     &testTimeSettled,
		Status:        "released",
	}
	canonicalInvocation := mustBytes(json.Marshal(invocation))
	contentHash := sha256.Sum256(canonicalInvocation)

	privateKeyBytes := make([]byte, 32)
	privateKeyBytes[31] = 1 // Public, deterministic fixture key; never use it.
	privateKey := &secp256k1.PrivKey{Key: privateKeyBytes}
	publicKey := privateKey.PubKey().(*secp256k1.PubKey)
	sourceAddress := sdk.AccAddress(publicKey.Address()).String()

	recipientKeyBytes := make([]byte, 32)
	recipientKeyBytes[31] = 2 // Public, deterministic fixture key; never use it.
	recipientKey := &secp256k1.PrivKey{Key: recipientKeyBytes}
	recipientAddress := sdk.AccAddress(recipientKey.PubKey().Address()).String()

	link := &substratebridgetypes.SubstrateLink{
		AdapterId: adapterID,
		Source: &substratebridgetypes.ExternalSource{
			SourceId:       sourceID,
			SourceUrl:      sourceURL,
			ContentHash:    contentHash[:],
			FetchedAtBlock: 699999,
		},
	}
	link.LinkHash = keeper.ComputeLinkHash(link)
	attestation := &substratebridgetypes.MsgSubmitExternalAttestation{
		Submitter:   sourceAddress,
		AdapterId:   adapterID,
		WorkClassId: workClassID,
		Link:        link,
		BondUzrn:    "1000000",
	}
	attestationBytes := mustBytes(proto.MarshalOptions{
		Deterministic: true,
	}.Marshal(attestation))
	var decodedAttestation substratebridgetypes.MsgSubmitExternalAttestation
	must(proto.Unmarshal(attestationBytes, &decodedAttestation))
	attestationRoundTrip := mustBytes(proto.MarshalOptions{
		Deterministic: true,
	}.Marshal(&decodedAttestation))
	exact("MsgSubmitExternalAttestation", attestationBytes, attestationRoundTrip)
	exact("keeper.ComputeLinkHash", link.LinkHash, keeper.ComputeLinkHash(decodedAttestation.Link))

	send := &banktypes.MsgSend{
		FromAddress: sourceAddress,
		ToAddress:   recipientAddress,
		Amount:      sdk.NewCoins(sdk.NewInt64Coin("uzrn", 123456)),
	}
	sendAny := mustAny(types.NewAnyWithValue(send))
	attestationAny := mustAny(types.NewAnyWithValue(attestation))
	if attestationAny.TypeUrl != "/zerone.substrate_bridge.v1.MsgSubmitExternalAttestation" {
		panic("unexpected generated attestation type URL: " + attestationAny.TypeUrl)
	}

	body := &txtypes.TxBody{Messages: []*types.Any{attestationAny}}
	bodyBytes := mustBytes(body.Marshal())
	var decodedBody txtypes.TxBody
	must(decodedBody.Unmarshal(bodyBytes))
	bodyRoundTrip := mustBytes(decodedBody.Marshal())
	exact("TxBody", bodyBytes, bodyRoundTrip)

	publicKeyAny := mustAny(types.NewAnyWithValue(publicKey))
	authInfo := &txtypes.AuthInfo{
		SignerInfos: []*txtypes.SignerInfo{{
			PublicKey: publicKeyAny,
			ModeInfo: &txtypes.ModeInfo{Sum: &txtypes.ModeInfo_Single_{
				Single: &txtypes.ModeInfo_Single{
					Mode: signing.SignMode_SIGN_MODE_DIRECT,
				},
			}},
			Sequence: 9,
		}},
		Fee: &txtypes.Fee{
			Amount:   sdk.NewCoins(sdk.NewInt64Coin("uzrn", 222222)),
			GasLimit: 222222,
		},
	}
	authInfoBytes := mustBytes(authInfo.Marshal())
	var decodedAuthInfo txtypes.AuthInfo
	must(decodedAuthInfo.Unmarshal(authInfoBytes))
	authInfoRoundTrip := mustBytes(decodedAuthInfo.Marshal())
	exact("AuthInfo", authInfoBytes, authInfoRoundTrip)

	signDoc := &txtypes.SignDoc{
		BodyBytes:     bodyBytes,
		AuthInfoBytes: authInfoBytes,
		ChainId:       chainID,
		AccountNumber: 7,
	}
	signDocBytes := mustBytes(signDoc.Marshal())
	var decodedSignDoc txtypes.SignDoc
	must(decodedSignDoc.Unmarshal(signDocBytes))
	signDocRoundTrip := mustBytes(decodedSignDoc.Marshal())
	exact("SignDoc", signDocBytes, signDocRoundTrip)

	simulationTx := &txtypes.TxRaw{
		BodyBytes:     bodyBytes,
		AuthInfoBytes: authInfoBytes,
		Signatures:    [][]byte{{}},
	}
	simulationTxBytes := mustBytes(simulationTx.Marshal())
	var decodedSimulationTx txtypes.TxRaw
	must(decodedSimulationTx.Unmarshal(simulationTxBytes))
	simulationTxRoundTrip := mustBytes(decodedSimulationTx.Marshal())
	exact("simulation TxRaw", simulationTxBytes, simulationTxRoundTrip)
	oneEmptySimulationSignature :=
		len(decodedSimulationTx.Signatures) == 1 &&
			len(decodedSimulationTx.Signatures[0]) == 0
	if !oneEmptySimulationSignature {
		panic("simulation TxRaw must contain exactly one empty signature")
	}

	signature := mustBytes(privateKey.Sign(signDocBytes))
	if len(signature) != 64 {
		panic("Cosmos secp256k1 signer did not return compact 64-byte signature")
	}
	cosmosSignatureVerified := publicKey.VerifySignature(signDocBytes, signature)
	if !cosmosSignatureVerified {
		panic("Cosmos secp256k1 PubKey.VerifySignature rejected fixture signature")
	}
	signedTx := &txtypes.TxRaw{
		BodyBytes:     bodyBytes,
		AuthInfoBytes: authInfoBytes,
		Signatures:    [][]byte{signature},
	}
	signedTxBytes := mustBytes(signedTx.Marshal())
	var decodedSignedTx txtypes.TxRaw
	must(decodedSignedTx.Unmarshal(signedTxBytes))
	signedTxRoundTrip := mustBytes(decodedSignedTx.Marshal())
	exact("signed TxRaw", signedTxBytes, signedTxRoundTrip)
	transactionHash := sha256.Sum256(signedTxBytes)

	var output vector
	output.Schema = "agent-wallet-zerone.go-cosmos-vectors/0.1"
	output.Provenance.Generator = "packages/wallet-zerone/scripts/go-cosmos-fixture/main.go"
	output.Provenance.ZeroneCoreCommit = zeroneCoreCommit
	output.Provenance.CosmosSDK = cosmosSDKVersion
	output.Profile.ChainReference = chainID
	output.Profile.AccountNumber = "7"
	output.Profile.Sequence = "9"
	output.Profile.GasLimit = "222222"
	output.Profile.FeeAmountUZRN = "222222"
	output.Profile.SourceAddress = sourceAddress
	output.Profile.RecipientAddress = recipientAddress
	output.Profile.PublicKeyB64U = b64u(publicKey.Bytes())
	output.Invocation.Projection = invocation
	output.Invocation.CanonicalBytesB64U = b64u(canonicalInvocation)
	output.Invocation.ContentHashHex = hexLower(contentHash[:])
	output.Invocation.LinkHashHex = hexLower(link.LinkHash)
	output.Invocation.AttestationValueB64U = b64u(attestationBytes)
	output.Invocation.MsgSendValueB64U = b64u(sendAny.Value)
	output.DirectSign.BodyBytesB64U = b64u(bodyBytes)
	output.DirectSign.AuthInfoBytesB64U = b64u(authInfoBytes)
	output.DirectSign.SignDocBytesB64U = b64u(signDocBytes)
	output.DirectSign.SimulationTxBytesB64U = b64u(simulationTxBytes)
	output.DirectSign.SignatureB64U = b64u(signature)
	output.DirectSign.SignedTxBytesB64U = b64u(signedTxBytes)
	output.DirectSign.TxHash = strings.ToUpper(hex.EncodeToString(transactionHash[:]))
	output.Verified.GeneratedMessageRoundTrip = true
	output.Verified.BodyRoundTrip = true
	output.Verified.AuthInfoRoundTrip = true
	output.Verified.SignDocRoundTrip = true
	output.Verified.SimulationTxRoundTrip = true
	output.Verified.SignedTxRoundTrip = true
	output.Verified.OneEmptySimulationSig = true
	output.Verified.CosmosSecpVerifySignature = true

	encoded, err := json.MarshalIndent(output, "", "  ")
	must(err)
	encoded = append(encoded, '\n')
	must(os.WriteFile(os.Args[1], encoded, 0o644))
}

func mustAny(value *types.Any, err error) *types.Any {
	must(err)
	return value
}
