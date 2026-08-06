// Definisi body untuk Swagger — modul Finance:
// Chart of Account, Journal Entry, Journal Write-Off, Account Receivable,
// Account Payable.
const FinanceSchema = {
  BodyChartOfAccountSchema: {
    code: "1110",
    name: "Cash on Hand",
    type: "ASSET",
    is_header: false,
    parent_id: "000000000000000000000000",
    description: "Petty cash account",
  },
  BodyJournalEntrySchema: {
    date: "2026-08-01",
    description: "Cash sales",
    reference: "INV-2026-0001",
    status: "DRAFT",
    lines: [
      {
        account_id: "000000000000000000000000",
        description: "Cash received",
        debit: 100000,
        credit: 0,
      },
      {
        account_id: "000000000000000000000000",
        description: "Sales revenue",
        debit: 0,
        credit: 100000,
      },
    ],
  },
  BodyJournalWriteOffSchema: {
    date: "2026-08-01",
    write_off_type: "RECEIVABLE",
    reference: "AR-202608-0001",
    description: "Bad debt write-off",
    status: "DRAFT",
    source_type: "ACCOUNT_RECEIVABLE",
    source_id: "000000000000000000000000",
    lines: [
      {
        account_id: "000000000000000000000000",
        description: "Bad debt expense",
        debit: 50000,
        credit: 0,
      },
      {
        account_id: "000000000000000000000000",
        description: "Accounts receivable",
        debit: 0,
        credit: 50000,
      },
    ],
  },
  BodyAccountReceivableSchema: {
    date: "2026-08-01",
    due_date: "2026-08-31",
    party_name: "PT Pelanggan Sejahtera",
    reference: "SO-2026-0001",
    description: "Invoice for August delivery",
    status: "DRAFT",
    paid_amount: 0,
    lines: [
      {
        account_id: "000000000000000000000000",
        description: "Product sales",
        amount: 250000,
      },
    ],
  },
  BodyAccountPayableSchema: {
    date: "2026-08-01",
    due_date: "2026-08-31",
    party_name: "PT Pemasok Makmur",
    reference: "BILL-2026-0001",
    description: "Bill for raw material purchase",
    status: "DRAFT",
    paid_amount: 0,
    lines: [
      {
        account_id: "000000000000000000000000",
        description: "Raw material purchase",
        amount: 175000,
      },
    ],
  },
};

module.exports = FinanceSchema;
