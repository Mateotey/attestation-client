// import { expectEvent } from "@openzeppelin/test-helpers";
// import { ChainType, IUtxoBlockRes, prefix0x, RPCInterface, toBN } from "flare-mcc";
// import { extractBNPaymentReference } from "../../lib/utils/utils";
// import {
//   attReqToTransactionAttestationRequest,
//   extractAttEvents,
//   transactionHash,
//   buildAttestationRequest
// } from "../../lib/verification/attestation-request-utils";
// import {
//   AttestationRequest,
//   ChainVerification,
//   TransactionAttestationRequest,
//   VerificationStatus
// } from "../../lib/verification/attestation-types/attestation-types";
// import { numberOfConfirmations } from "../../lib/verification/confirmations";
// import { AttestationType } from "../../lib/verification/generated/attestation-types-enum";
// import { verifyTransactionAttestation } from "../../lib/verification/verification";
// import { StateConnectorInstance } from "../../typechain-truffle";


// export async function testHashOnContract(txData: ChainVerification, hash: string) {
//   let HashTest = artifacts.require("HashTest");
//   let hashTest = await HashTest.new();

//   switch (txData.attestationType) {
//     case AttestationType.Payment:
//       return await hashTest.testPayment(
//         txData!.attestationType,
//         txData!.chainId!,
//         txData!.blockNumber,
//         txData!.blockTimestamp,
//         txData!.txId,
//         txData!.utxo || toBN(0),
//         web3.utils.soliditySha3(txData!.sourceAddresses as string)!,
//         web3.utils.soliditySha3(txData!.destinationAddresses as string)!,
//         extractBNPaymentReference(txData!.paymentReference!),
//         txData!.spent as BN,
//         txData!.delivered as BN,
//         txData!.isFromOne as boolean,
//         toBN(txData!.status as number),
//         hash!
//       )
//     case AttestationType.BalanceDecreasingPayment:
//       return await hashTest.testDecreaseBalanceProof(
//         txData!.attestationType,
//         txData!.chainId!,
//         txData!.blockNumber,
//         txData!.txId,
//         web3.utils.soliditySha3(txData!.sourceAddresses as string)!,
//         txData!.spent as BN,
//         hash!
//       )
//     default:
//       throw new Error(`Unsupported attestation type ${txData.attestationType}`)
//   }
// }

// export async function sendAttestationRequest(stateConnector: StateConnectorInstance, request: AttestationRequest) {
//   return await stateConnector.requestAttestations(request.instructions, request.id, request.dataAvailabilityProof);
// }

// export function verifyReceiptAgainstTemplate(receipt: any, template: TransactionAttestationRequest) {
//   expectEvent(receipt, "AttestationRequest")
//   let events = extractAttEvents(receipt.logs);
//   let parsedEvents = events.map((x: AttestationRequest) => attReqToTransactionAttestationRequest(x))
//   assert(parsedEvents.length === 1);
//   let eventRequest = parsedEvents[0];
//   // assert((eventRequest.blockNumber as BN).eq(toBN(template.blockNumber as number)), "Block number does not match");
//   assert((eventRequest.chainId as BN).eq(toBN(template.chainId as number)), "Chain id  does not match");
//   assert(eventRequest.attestationType === template.attestationType, "Attestation type does not match");
//   return eventRequest;
// }

// export async function testUtxo(
//   client: RPCInterface, stateConnector: StateConnectorInstance, chainType: ChainType,
//   txId: string, blockNumber: number, utxo: number, targetStatus: VerificationStatus
// ) {
//   let block = await client.getBlock(blockNumber) as IUtxoBlockRes;
//   let confirmationHeight = block.height + numberOfConfirmations(chainType);
//   let confirmationBlock = await client.getBlock(confirmationHeight) as IUtxoBlockRes;
//   let template = {
//     attestationType: AttestationType.Payment,
//     instructions: toBN(0),
//     id: prefix0x(txId),
//     utxo: utxo,
//     dataAvailabilityProof: prefix0x(confirmationBlock.hash),
//     chainId: chainType,
//     blockNumber: blockNumber
//   } as TransactionAttestationRequest;
//   let request = buildAttestationRequest(template);

//   // send it to contract
//   let receipt: any = null;
//   try {
//     receipt = await sendAttestationRequest(stateConnector, request);
//   } catch (e) {
//     throw new Error(`${e}`)
//   }
//   // intercept events
//   let events = extractAttEvents(receipt.logs);
//   let parsedEvents = events.map((x: AttestationRequest) => attReqToTransactionAttestationRequest(x))
//   assert(parsedEvents.length === 1);
//   let txAttReq = parsedEvents[0];

//   // verify
//   let txData = await verifyTransactionAttestation(client, txAttReq, {skipDataAvailabilityProof: true})

//   assert(txData.verificationStatus === targetStatus, `Incorrect status ${txData.verificationStatus}`)
//   if (targetStatus === VerificationStatus.OK) {
//     let hash = transactionHash(web3, txData!);
//     let res = testHashOnContract(txData!, hash!);
//     assert(res);
//   }
// }

// export interface UtxoTraverseTestOptions {
//   attestationTypes?: AttestationType[];
//   filterStatusPrintouts?: VerificationStatus[];
//   count?: number;
//   numberOfInputsChecked?: number;
// }

// export async function traverseAndTestUtxoChain(
//   client: RPCInterface,
//   stateConnector: StateConnectorInstance,
//   chainType: ChainType,
//   options?: UtxoTraverseTestOptions
// ) {
//   // Defaults
//   const count = options?.count || 1;
//   const attestationTypes = options?.attestationTypes || [AttestationType.Payment];
//   const filterStatusPrintouts = options?.filterStatusPrintouts || [];
//   const numberOfInputsChecked = options?.numberOfInputsChecked || 3;

//   // Validation
//   const latestBlockNumber = await client.getBlockHeight();
//   const latestBlockNumberToUse = latestBlockNumber - numberOfConfirmations(chainType);

//   for (let i = latestBlockNumberToUse - count + 1; i <= latestBlockNumberToUse; i++) {
//     let block = await client.getBlock(i) as IUtxoBlockRes;
//     let confirmationBlock = await client.getBlock(i + numberOfConfirmations(chainType)) as IUtxoBlockRes;
//     for (let id of await client.getTransactionHashesFromBlock(block)) {
//       for (let attType of attestationTypes) {
//         for (let utxo = 0; utxo < numberOfInputsChecked; utxo++) {
//           let tr = {
//             id: prefix0x(id),
//             dataAvailabilityProof: prefix0x(confirmationBlock.hash),
//             utxo,
//             blockNumber: i,
//             chainId: chainType,
//             attestationType: attType,
//             instructions: toBN(0)   // inital empty setting, will be consturcted
//           } as TransactionAttestationRequest;
//           console.log(`Checking: type: ${attType}, txid: ${tr.id}, block ${i}, utxo ${utxo}`);
//           let attRequest = buildAttestationRequest(tr);
//           let receipt: any = null;

//           try {
//             receipt = await sendAttestationRequest(stateConnector, attRequest);
//           } catch (e) {
//             throw new Error(`${e}`);
//           }
//           let eventRequest = verifyReceiptAgainstTemplate(receipt, tr);

//           // verify
//           let txData = await verifyTransactionAttestation(client, eventRequest, {skipDataAvailabilityProof: true})

//           /////////////////////////////////////////////////////////////////
//           /// Filtering printouts for (known) statuses
//           if (filterStatusPrintouts.indexOf(txData.verificationStatus) >= 0) {
//             continue;
//           }
//           /////////////////////////////////////////////////////////////////

//           if (txData.verificationStatus != VerificationStatus.OK) {
//             console.log(txData.verificationStatus);
//             continue;
//           }
//           assert(txData.verificationStatus === VerificationStatus.OK, `Incorrect verification status ${txData.verificationStatus}`)
//           console.log(VerificationStatus.OK);
//           let hash = transactionHash(web3, txData!);
//           let res = testHashOnContract(txData!, hash!);
//           assert(res);
//         }
//       }
//     }
//   }

// }
