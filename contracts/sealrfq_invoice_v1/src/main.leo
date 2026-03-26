import sealrfq_v18.aleo;
import test_usdcx_stablecoin.aleo;
import test_usad_stablecoin.aleo;

program sealrfq_invoice_v1.aleo {
    const MAX_BID_AMOUNT: u64 = 1_000_000_000u64;

    struct ReceiptInput {
        rfq_id: field,
        payer:  address,
        winner: address,
        amount: u64,
        nonce:  field,
    }

    record InvoiceReceipt {
        owner:        address,
        rfq_id:       field,
        receipt_hash: field,
        amount:       u64,
    }

    @noupgrade
    async constructor() {}

    async transition pay_invoice_usdcx(
        public rfq_id:        field,
        public winner:        address,
        public amount:        u64,
        public invoice_nonce: u64,
               receipt_nonce: field,
               payment:       test_usdcx_stablecoin.aleo/Token,
               proofs:        [test_usdcx_stablecoin.aleo/MerkleProof; 2]
    ) -> (test_usdcx_stablecoin.aleo/ComplianceRecord,
          test_usdcx_stablecoin.aleo/Token,
          test_usdcx_stablecoin.aleo/Token,
          InvoiceReceipt, Future) {
        assert(rfq_id        != 0field);
        assert(amount         > 0u64);
        assert(amount         < MAX_BID_AMOUNT);
        assert(winner        != aleo1qqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqq3ljyzc);
        assert(receipt_nonce != 0field);

        let (compliance, recv, change, transfer_future):
            (test_usdcx_stablecoin.aleo/ComplianceRecord,
             test_usdcx_stablecoin.aleo/Token,
             test_usdcx_stablecoin.aleo/Token,
             Future) =
            test_usdcx_stablecoin.aleo/transfer_private(
                winner, amount as u128, payment, proofs
            );

        let receipt_hash: field = BHP256::hash_to_field(ReceiptInput {
            rfq_id: rfq_id,
            payer:  self.caller,
            winner: winner,
            amount: amount,
            nonce:  receipt_nonce,
        });

        let nonce_scalar: scalar = BHP256::hash_to_scalar(receipt_nonce);
        let amount_field: field = amount as field;
        let payment_commitment: field = BHP256::commit_to_field(amount_field, nonce_scalar);

        let receipt: InvoiceReceipt = InvoiceReceipt {
            owner:        self.caller,
            rfq_id:       rfq_id,
            receipt_hash: receipt_hash,
            amount:       amount,
        };

        let record_future: Future = sealrfq_v18.aleo/record_invoice_usdcx(
            rfq_id,
            winner,
            amount,
            invoice_nonce,
            receipt_hash,
            self.caller,
            payment_commitment
        );

        let f: Future = finalize_invoice(transfer_future, record_future);
        return (compliance, recv, change, receipt, f);
    }

    async transition pay_invoice_usad(
        public rfq_id:        field,
        public winner:        address,
        public amount:        u64,
        public invoice_nonce: u64,
               receipt_nonce: field,
               payment:       test_usad_stablecoin.aleo/Token,
               proofs:        [test_usad_stablecoin.aleo/MerkleProof; 2]
    ) -> (test_usad_stablecoin.aleo/ComplianceRecord,
          test_usad_stablecoin.aleo/Token,
          test_usad_stablecoin.aleo/Token,
          InvoiceReceipt, Future) {
        assert(rfq_id        != 0field);
        assert(amount         > 0u64);
        assert(amount         < MAX_BID_AMOUNT);
        assert(winner        != aleo1qqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqq3ljyzc);
        assert(receipt_nonce != 0field);

        let (compliance, recv, change, transfer_future):
            (test_usad_stablecoin.aleo/ComplianceRecord,
             test_usad_stablecoin.aleo/Token,
             test_usad_stablecoin.aleo/Token,
             Future) =
            test_usad_stablecoin.aleo/transfer_private(
                winner, amount as u128, payment, proofs
            );

        let receipt_hash: field = BHP256::hash_to_field(ReceiptInput {
            rfq_id: rfq_id,
            payer:  self.caller,
            winner: winner,
            amount: amount,
            nonce:  receipt_nonce,
        });

        let nonce_scalar: scalar = BHP256::hash_to_scalar(receipt_nonce);
        let amount_field: field = amount as field;
        let payment_commitment: field = BHP256::commit_to_field(amount_field, nonce_scalar);

        let receipt: InvoiceReceipt = InvoiceReceipt {
            owner:        self.caller,
            rfq_id:       rfq_id,
            receipt_hash: receipt_hash,
            amount:       amount,
        };

        let record_future: Future = sealrfq_v18.aleo/record_invoice_usad(
            rfq_id,
            winner,
            amount,
            invoice_nonce,
            receipt_hash,
            self.caller,
            payment_commitment
        );

        let f: Future = finalize_invoice(transfer_future, record_future);
        return (compliance, recv, change, receipt, f);
    }

    async function finalize_invoice(
        transfer_future: Future,
        record_future:   Future
    ) {
        transfer_future.await();
        record_future.await();
    }
}
