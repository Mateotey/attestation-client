import { AttestationType } from "../../generated/attestation-types-enum";

////////////////////////////////////////////////////////////////////////////////////////
// Support
////////////////////////////////////////////////////////////////////////////////////////

export function isSupportedTransactionUtxo(transaction: any, attType: AttestationType): boolean {
  return true;
}
