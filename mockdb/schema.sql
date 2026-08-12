-- Jhaveri OS — mock database schema (seed engine, migration-zero shape)
-- Generated 07-Aug-2026 from the verified production capture (schema-docs/intel).
-- Dialect: SQLite for the prototype. Postgres divergences noted as "-- pg:".
-- Carried tables use EXACT production table/column names, restricted to the columns
-- the 23 mapped pages consume (schema-map artifacts define the mapping).
-- NEW objects (22) are full definitions — they become the real build's first migration.
-- Dates stored as ISO-8601 TEXT (pg: date/timestamptz). JSON as TEXT (pg: jsonb).

PRAGMA foreign_keys = ON;

------------------------------------------------------------------------------
-- SECTION 1 · CARRIED — identity & distribution force
------------------------------------------------------------------------------

CREATE TABLE client_master (
  cm_user_id              INTEGER PRIMARY KEY,
  cm_full_name            TEXT NOT NULL,
  cm_first_name           TEXT,
  cm_last_name            TEXT,
  cm_pan_no               TEXT,                -- format ^[A-Z]{5}[0-9]{4}[A-Z]$
  cm_date_of_birth        TEXT,
  cm_gender               TEXT,
  cm_mobile_number        TEXT,
  cm_email_id             TEXT,
  cm_bos_code             TEXT UNIQUE,
  cm_bos_code_source      TEXT DEFAULT 'N',
  cm_tax_status_id        INTEGER,
  fk_family_id            INTEGER REFERENCES family_master(family_id),
  is_family_head          INTEGER DEFAULT 0,
  fk_primary_sub_broker_id INTEGER REFERENCES sub_broker_master(sb_id),
  is_active               INTEGER DEFAULT 1,
  is_client_prospect      INTEGER DEFAULT 0,
  is_kyc_done             INTEGER DEFAULT 0,
  is_fatca_done           INTEGER DEFAULT 0,
  is_client_app           INTEGER DEFAULT 0,
  created_date            TEXT
);

CREATE TABLE client_master_mf_related (
  id              INTEGER PRIMARY KEY,
  fk_cm_user_id   INTEGER NOT NULL REFERENCES client_master(cm_user_id),
  tax_status      TEXT,
  kyc_done        TEXT,
  risk_profile    TEXT,                        -- Moderate | Aggressive | Very Aggressive
  risk_prof_date  TEXT,
  politically_exposed TEXT DEFAULT 'No',       -- Yes | Related | No
  net_worth       NUMERIC
);

CREATE TABLE family_master (
  family_id       INTEGER PRIMARY KEY,
  family_name     TEXT NOT NULL,
  family_head_name TEXT,
  group_code      TEXT UNIQUE,                 -- letter+5 digits e.g. P00001
  total_members   INTEGER DEFAULT 1,
  is_active       INTEGER DEFAULT 1
);

CREATE TABLE accounts_master (
  acc_id              INTEGER PRIMARY KEY,
  fk_cm_user_id       INTEGER NOT NULL REFERENCES client_master(cm_user_id),
  acc_name            TEXT,
  acc_bos_code        TEXT,
  acc_bse_code        TEXT,                    -- UCC, MKYC-prefixed
  acc_activation_date TEXT,
  is_active           INTEGER DEFAULT 1,
  is_prospect         INTEGER DEFAULT 0
);

CREATE TABLE client_login_master (
  clm_id        INTEGER PRIMARY KEY,
  fk_cm_user_id INTEGER REFERENCES client_master(cm_user_id),
  clm_email     TEXT,
  clm_pan_no    TEXT,
  is_kyc        INTEGER DEFAULT 0,
  fk_sb_id      INTEGER,
  last_login_at TEXT
);

CREATE TABLE client_login_requests (
  id         INTEGER PRIMARY KEY,
  name       TEXT, email TEXT, mobile TEXT, pan TEXT,
  status     TEXT, type TEXT, message TEXT,
  fk_clm_id  INTEGER,
  updated_by INTEGER,
  created_at TEXT
);

CREATE TABLE sub_broker_category_master (
  cat_id            INTEGER PRIMARY KEY,
  cat_category_name TEXT NOT NULL,             -- Silver … Platinum, BRONZE, MOTI, Urja, YASH
  is_active         INTEGER DEFAULT 1
);

CREATE TABLE territory_master (
  territory_id          INTEGER PRIMARY KEY,
  territory_name        TEXT NOT NULL,
  territory_code        TEXT,
  parent_territory      INTEGER REFERENCES territory_master(territory_id),
  fk_territory_type_id  INTEGER,               -- 1 Head 2 Zonal 3 Regional 4 Branch
  territory_city        TEXT,
  is_active             INTEGER DEFAULT 1
);

CREATE TABLE sub_broker_master (
  sb_id               INTEGER PRIMARY KEY,
  sb_holder_name      TEXT NOT NULL,
  sb_sub_broker_code  TEXT UNIQUE,
  sb_bos_code         TEXT,
  sb_arn_no           TEXT,
  sb_euin             TEXT,
  sb_holder_pan       TEXT,
  sb_gst_no           TEXT,                    -- NULL = not GST-registered
  sb_tds_deduction    NUMERIC DEFAULT 5.0,
  fk_cat_id           INTEGER REFERENCES sub_broker_category_master(cat_id),
  fk_territory_id     INTEGER REFERENCES territory_master(territory_id),
  sb_reporting_to     INTEGER,
  sb_doj              TEXT,
  sb_valid_to         TEXT,
  sb_termination      TEXT,
  is_employee         INTEGER DEFAULT 0,
  is_active           INTEGER DEFAULT 1
);

CREATE TABLE client_sub_broker_mapping (
  id            INTEGER PRIMARY KEY,
  cm_user_id    INTEGER NOT NULL REFERENCES client_master(cm_user_id),
  sb_id         INTEGER NOT NULL REFERENCES sub_broker_master(sb_id),
  is_primary    INTEGER DEFAULT 0,
  created_by    INTEGER,
  created_date  TEXT,
  UNIQUE (cm_user_id, sb_id)
);

CREATE TABLE sb_hierarchy (
  sb_hierarchy_id INTEGER PRIMARY KEY,
  fk_sb_id        INTEGER NOT NULL REFERENCES sub_broker_master(sb_id),
  fk_reporting_to INTEGER REFERENCES sub_broker_master(sb_id),
  fk_territory_id INTEGER REFERENCES territory_master(territory_id),
  fk_role_id      INTEGER,
  is_active       INTEGER DEFAULT 1
);

CREATE TABLE sb_monthly_target (
  id                    INTEGER PRIMARY KEY,
  fk_sb_id              INTEGER NOT NULL REFERENCES sub_broker_master(sb_id),
  target_month          TEXT NOT NULL,         -- first of month, ISO
  target_lumpsum_amount NUMERIC,
  target_sip_count      INTEGER,
  target_sip_amount     NUMERIC,
  target_client_count   INTEGER,
  UNIQUE (fk_sb_id, target_month)
);

------------------------------------------------------------------------------
-- SECTION 2 · CARRIED — product & market data
------------------------------------------------------------------------------

CREATE TABLE amc_master (
  amc_id    INTEGER PRIMARY KEY,
  amc_name  TEXT NOT NULL,
  is_active INTEGER DEFAULT 1
);

CREATE TABLE main_asset_master (
  id              INTEGER PRIMARY KEY,
  main_asset_name TEXT NOT NULL                -- Equity | Debt | Hybrid | Commodities | Solution Oriented | Other Schemes
);

CREATE TABLE category_master (
  category_id       INTEGER PRIMARY KEY,
  category_name     TEXT NOT NULL,
  fk_main_asset_id  INTEGER REFERENCES main_asset_master(id),
  is_active         INTEGER DEFAULT 1
);

CREATE TABLE benchmark_master (
  benchmark_id   INTEGER PRIMARY KEY,
  benchmark_name TEXT NOT NULL
);

CREATE TABLE scheme_master (
  scheme_id           INTEGER PRIMARY KEY,
  scheme_full_name    TEXT NOT NULL,
  scheme_short_name   TEXT,
  fk_amc_id           INTEGER REFERENCES amc_master(amc_id),
  fk_category_id      INTEGER REFERENCES category_master(category_id),
  fk_benchmark_id     INTEGER REFERENCES benchmark_master(benchmark_id),
  scheme_amfi_code    TEXT,
  scheme_isin_code    TEXT,
  scheme_rta          TEXT,                    -- 'C' CAMS | 'K' KARVY
  scheme_exit_load    NUMERIC DEFAULT 0,       -- % if redeemed within exit-load window
  scheme_expense_ratio NUMERIC,
  scheme_day_end_nav  NUMERIC,
  scheme_day_end_nav_date TEXT,
  risk_level          TEXT,
  is_jhaveri_pick     INTEGER DEFAULT 0,
  is_active           INTEGER DEFAULT 1
);

CREATE TABLE mf_latest_price_master (
  fk_scheme_id INTEGER PRIMARY KEY REFERENCES scheme_master(scheme_id),
  price        REAL NOT NULL,
  price_date   TEXT NOT NULL
);

CREATE TABLE stock_master (                 -- underlying securities (fund-data feed)
  stock_id     TEXT PRIMARY KEY,
  stock_name   TEXT NOT NULL,
  sector       TEXT,
  industry     TEXT,
  cap_band     TEXT,                          -- Large | Mid | Small (AMFI rank convention)
  market_cap   NUMERIC
);

CREATE TABLE mf_scheme_holdings (           -- what each fund actually owns
  fk_scheme_id INTEGER NOT NULL REFERENCES scheme_master(scheme_id),
  stock_id     TEXT NOT NULL REFERENCES stock_master(stock_id),
  weight_pct   NUMERIC NOT NULL,
  as_of_date   TEXT NOT NULL,
  PRIMARY KEY (fk_scheme_id, stock_id)
);
CREATE INDEX idx_msh_stock ON mf_scheme_holdings(stock_id);

CREATE TABLE benchmark_price_history (      -- index level history (TRI), monthly
  fk_benchmark_id INTEGER NOT NULL REFERENCES benchmark_master(benchmark_id),
  price_date      TEXT NOT NULL,
  price           NUMERIC NOT NULL,
  PRIMARY KEY (fk_benchmark_id, price_date)
);

CREATE TABLE mf_historical_price_master (
  fk_scheme_id INTEGER NOT NULL REFERENCES scheme_master(scheme_id),
  price_date   TEXT NOT NULL,
  price        REAL NOT NULL,
  PRIMARY KEY (fk_scheme_id, price_date)
);

CREATE TABLE capital_gain_period_master (
  id                    INTEGER PRIMARY KEY,
  fk_asset_id           INTEGER,               -- main asset axis
  from_date             TEXT, to_date TEXT,    -- regime band (23-Jul-2024 change encoded as rows)
  holding_period_years  NUMERIC,               -- LT threshold (equity 1y, debt varies by band)
  gain_term_if_less_than        TEXT,          -- SE | SD
  gain_term_if_equal_or_more_than TEXT         -- LE | LD
);

CREATE TABLE transaction_type_master (
  tr_type_id                    INTEGER PRIMARY KEY,
  tr_type_name                  TEXT NOT NULL,
  tr_type_buy_sell_flag         INTEGER,       -- 1 buy | -1 sell | 0 neutral
  is_reversal                   INTEGER DEFAULT 0,
  is_corporate_action           INTEGER DEFAULT 0,
  tr_type_add_in_fifo           INTEGER DEFAULT 1,
  tr_type_add_in_xirr           INTEGER DEFAULT 1,
  tr_type_add_in_tax            INTEGER DEFAULT 1,
  tr_type_add_in_capital_gains  INTEGER DEFAULT 1,
  tr_type_add_in_portfolio_valuation INTEGER DEFAULT 1,
  is_active                     INTEGER DEFAULT 1
);

CREATE TABLE rta_trxn_type (
  rta_trxn_type_id    INTEGER PRIMARY KEY,
  rta_trxn_type_desc  TEXT NOT NULL,
  fk_tr_type_id       INTEGER REFERENCES transaction_type_master(tr_type_id),
  tr_type_buy_sell_flag INTEGER
);

CREATE TABLE trans_status_master (
  trans_status_id   INTEGER PRIMARY KEY,
  trans_status_name TEXT NOT NULL              -- Pending…Completed…Rejected (10 values)
);

CREATE TABLE frequency_master (
  freq_id   INTEGER PRIMARY KEY,
  freq_code TEXT, freq_name TEXT
);

------------------------------------------------------------------------------
-- SECTION 3 · CARRIED — folios, transactions, systematic plans
------------------------------------------------------------------------------

CREATE TABLE folio_master (
  folio_id          INTEGER PRIMARY KEY,
  fm_folio_no       TEXT NOT NULL,
  fk_scheme_id      INTEGER NOT NULL REFERENCES scheme_master(scheme_id),
  fk_acc_id         INTEGER REFERENCES accounts_master(acc_id),
  fm_pan_no         TEXT,
  fm_sub_broker_code TEXT,                     -- broker code as the RTA file carries it
  fm_arn_no         TEXT,
  fm_euin           TEXT,
  fm_holding        TEXT,                      -- Single | Joint | Anyone or Survivor
  fm_nominee1_name  TEXT,
  folio_start_date  TEXT,
  fm_freeze_date    TEXT,
  is_transferred_out INTEGER DEFAULT 0,
  transfer_out_date TEXT,
  is_absent         INTEGER DEFAULT 0,
  is_active         INTEGER DEFAULT 1,
  UNIQUE (fm_folio_no, fk_scheme_id)
);

CREATE TABLE transaction_master (
  tr_id             INTEGER PRIMARY KEY,
  tr_bos_code       TEXT UNIQUE,
  fk_acc_id         INTEGER NOT NULL REFERENCES accounts_master(acc_id),
  fk_scheme_id      INTEGER NOT NULL REFERENCES scheme_master(scheme_id),
  tr_folio_no       TEXT NOT NULL,
  fk_tran_type_id   INTEGER NOT NULL REFERENCES transaction_type_master(tr_type_id),
  fk_txn_status_id  INTEGER REFERENCES trans_status_master(trans_status_id),
  fk_sb_id          INTEGER REFERENCES sub_broker_master(sb_id),
  tr_date           TEXT NOT NULL,
  tr_amount         NUMERIC,
  tr_units          NUMERIC,
  tr_price          NUMERIC,
  tr_stt            NUMERIC DEFAULT 0,
  tr_stamp_duty     NUMERIC DEFAULT 0,
  tr_exit_load      NUMERIC DEFAULT 0,
  tr_benchmark_price NUMERIC,
  tr_bsense_order_no TEXT,
  tr_sip_reg_number TEXT,
  tr_file_euin      TEXT,
  tr_file_sub_broker_code TEXT,
  fk_goal_id        INTEGER,
  fk_file_upload_id INTEGER,
  is_rejected       INTEGER DEFAULT 0,
  is_cob            INTEGER DEFAULT 0,
  is_r2a            INTEGER DEFAULT 0,
  is_active         INTEGER DEFAULT 1
);
CREATE INDEX idx_tm_acc_scheme ON transaction_master(fk_acc_id, fk_scheme_id);
CREATE INDEX idx_tm_sb_date    ON transaction_master(fk_sb_id, tr_date);
CREATE INDEX idx_tm_date       ON transaction_master(tr_date);

CREATE TABLE sip_master (
  sip_id            INTEGER PRIMARY KEY,
  fk_acc_id         INTEGER NOT NULL REFERENCES accounts_master(acc_id),
  fk_from_scheme_id INTEGER REFERENCES scheme_master(scheme_id),
  fk_to_scheme_id   INTEGER REFERENCES scheme_master(scheme_id),
  fk_sb_id          INTEGER REFERENCES sub_broker_master(sb_id),
  fk_freq_id        INTEGER REFERENCES frequency_master(freq_id),
  tr_folio_no       TEXT,
  sip_type          TEXT,                      -- SIP | STP | SWP
  tr_amount         NUMERIC,
  day_of_sip        INTEGER,
  start_date        TEXT,
  end_date          TEXT,
  cease_date        TEXT,
  is_live_sip       INTEGER DEFAULT 1,
  termination_remarks TEXT,
  sxp_bos_code      TEXT
);

CREATE TABLE bse_sxp_list (
  id                INTEGER PRIMARY KEY,
  reg_no            TEXT,
  sxp_type          TEXT,
  ucc               TEXT,
  amount            NUMERIC,
  start_date        TEXT,
  end_date          TEXT,
  status            TEXT,
  exch_mandate_id   INTEGER,
  next_due_date     TEXT,
  npayments_missed  INTEGER DEFAULT 0,
  n_installment_paid INTEGER DEFAULT 0,
  previous_paid_date TEXT,
  sub_broker_code   TEXT,
  euin              TEXT
);

CREATE TABLE bse_mandate_list (
  id              INTEGER PRIMARY KEY,
  exch_mandate_id INTEGER UNIQUE,
  ucc             TEXT,
  amount          NUMERIC,                     -- cap per debit
  type            TEXT,                        -- NACH | E-MANDATE
  status          TEXT,
  umrn            TEXT,
  bank_name       TEXT,
  start_date      TEXT,
  end_date        TEXT,
  audit_trail     TEXT
);

CREATE TABLE bse_client_master (
  id              INTEGER PRIMARY KEY,
  bse_client_id   TEXT UNIQUE,                 -- MKYC-prefixed UCC
  ucc_status      TEXT,
  holding_pattern TEXT,
  first_applicant TEXT,
  pan_no          TEXT,
  kyc_type        TEXT
);

CREATE TABLE bse_order_list (
  id              INTEGER PRIMARY KEY,
  order_id        INTEGER UNIQUE,
  mem_ord_ref_id  TEXT,
  ucc             TEXT,
  order_type      TEXT,                        -- PURCHASE | REDEMPTION | SWITCH
  scheme          TEXT,
  dest_scheme     TEXT,
  amount          NUMERIC,
  is_units        INTEGER DEFAULT 0,
  status          TEXT,
  placed_at       TEXT,
  allotment_date  TEXT,
  allotment_units NUMERIC,
  allotment_amount NUMERIC,
  allotment_nav   NUMERIC,
  stt             NUMERIC,
  stamp_duty      NUMERIC,
  arn             TEXT,
  sub_broker_code TEXT,
  euin            TEXT,
  rejection_reason TEXT,
  is_reject_send  INTEGER DEFAULT 0,
  source          TEXT DEFAULT 'Unknown'
);

CREATE TABLE bse_order_history (
  id           INTEGER PRIMARY KEY,
  order_id     INTEGER NOT NULL,
  event_status TEXT,
  event_time   TEXT,
  sort_order   INTEGER
);

CREATE TABLE pending_order_item (            -- maker-checker (revived)
  id               INTEGER PRIMARY KEY,
  batch_id         TEXT,
  clm_id           INTEGER,
  order_type       TEXT,
  transaction_type TEXT,
  request_json     TEXT,                      -- pg: jsonb
  scheme_from_id   INTEGER,
  scheme_to_id     INTEGER,
  amount           NUMERIC,
  units            NUMERIC,
  folio_no         TEXT,
  status           TEXT DEFAULT 'PENDING',
  created_by       INTEGER,
  approved_by      INTEGER,
  created_at       TEXT,
  approved_at      TEXT,
  euin_no          TEXT,
  sub_broker_code  TEXT,
  source           TEXT DEFAULT 'ui'          -- NEW column: ui | service_ticket | api
);

CREATE TABLE rejection_master (
  rm_id        INTEGER PRIMARY KEY,
  rm_folio_no  TEXT,
  fk_scheme_id INTEGER,
  fk_acc_id    INTEGER,
  fk_sb_id     INTEGER,
  fk_tr_type_id INTEGER,
  rm_tr_date   TEXT,
  rm_amount    NUMERIC,
  rm_units     NUMERIC,
  rm_remarks   TEXT
);

CREATE TABLE redemption_limit_alert (
  id        INTEGER PRIMARY KEY,
  type      TEXT,
  amount    NUMERIC,
  alert_for TEXT,                              -- NORMAL | PORTFOLIO
  status    INTEGER DEFAULT 1
);

------------------------------------------------------------------------------
-- SECTION 4 · CARRIED — FIFO engine outputs (seed computes these honestly)
------------------------------------------------------------------------------

CREATE TABLE fifo_purchase_log (
  id            INTEGER PRIMARY KEY,
  purchase_id   INTEGER,                       -- tr_id of the buy
  acc_id        INTEGER, scheme_id INTEGER, folio_no TEXT,
  tr_date       TEXT,
  purchase_unit NUMERIC,
  balance_unit  NUMERIC,
  purchase_price NUMERIC,
  tr_bos_code   TEXT
);

CREATE TABLE fifo_purchase_sales_log (
  id                   INTEGER PRIMARY KEY,
  fifo_purchase_log_id INTEGER REFERENCES fifo_purchase_log(id),
  sell_id              INTEGER,                -- tr_id of the sell
  acc_id INTEGER, scheme_id INTEGER, folio_no TEXT,
  tr_date              TEXT,
  sell_unit            NUMERIC,
  sell_price           NUMERIC,
  holding_days         INTEGER,
  tr_bos_code          TEXT
);

CREATE TABLE fifo_detail_holding_latest (     -- per open lot, latest valuation
  dhl_id                INTEGER PRIMARY KEY,
  fk_acc_id             INTEGER, fk_scheme_id INTEGER, dhl_folio_no TEXT,
  fk_sb_id              INTEGER,
  fk_benchmark_id       INTEGER,
  dhl_purchase_date     TEXT,
  dhl_purchase_units    NUMERIC,
  dhl_purchase_price    NUMERIC,
  dhl_purchase_amount   NUMERIC,
  dhl_current_price     NUMERIC,
  dhl_current_value     NUMERIC,
  dhl_invested_value    NUMERIC,
  dhl_holding_days      INTEGER,
  dhl_holding_date      TEXT,
  dhl_valuation_date    TEXT,
  dhl_unrealized_ltcg   NUMERIC DEFAULT 0,
  dhl_unrealized_stcg   NUMERIC DEFAULT 0,
  dhl_benchmark_units   NUMERIC,
  dhl_benchmark_price   NUMERIC,
  dhl_benchmark_market_value NUMERIC,
  dhl_benchmark_date    TEXT
);
CREATE INDEX idx_dhl_acc ON fifo_detail_holding_latest(fk_acc_id, fk_scheme_id);

CREATE TABLE fifo_summary_holding (           -- latest holding_date row per folio×scheme
  sh_id               INTEGER PRIMARY KEY,
  fk_acc_id           INTEGER, fk_scheme_id INTEGER, sh_folio_no TEXT,
  fk_sb_id            INTEGER,
  fk_benchmark_id     INTEGER,
  sh_holding_date     TEXT,
  sh_units            NUMERIC,
  sh_price            NUMERIC,
  sh_current_value    NUMERIC,
  sh_invested_value   NUMERIC,
  sh_realized_ltcg    NUMERIC DEFAULT 0,
  sh_realized_stcg    NUMERIC DEFAULT 0,
  sh_unrealized_ltcg  NUMERIC DEFAULT 0,
  sh_unrealized_stcg  NUMERIC DEFAULT 0,
  sh_xirr             NUMERIC,
  sh_bmxirr           NUMERIC,
  absolute_return     NUMERIC,
  sh_first_purchase_date TEXT
);

CREATE TABLE fifo_summary_holding_active (    -- denormalized serving table
  id              INTEGER PRIMARY KEY,
  acc_id          INTEGER, scheme_id INTEGER, folio_no TEXT,
  client_id       INTEGER, client_name TEXT,
  family_id       INTEGER, family_name TEXT,
  pan_no          TEXT,
  advisor_code    TEXT, advisor_name TEXT,
  fund_name       TEXT, fund_category TEXT, asset_name TEXT,
  tax_status      TEXT,
  holding_date    TEXT,
  inv_since_date  TEXT,
  balance_units   NUMERIC,
  avg_cost        NUMERIC,
  cost_amount     NUMERIC,
  nav             NUMERIC,
  present_market_value NUMERIC,
  portfolio_weight NUMERIC,
  abs_ret         NUMERIC,
  xirr            NUMERIC
);
CREATE INDEX idx_fsha_client  ON fifo_summary_holding_active(client_id);
CREATE INDEX idx_fsha_advisor ON fifo_summary_holding_active(advisor_code);

------------------------------------------------------------------------------
-- SECTION 5 · CARRIED — AUM recon, imports, KYC
------------------------------------------------------------------------------

CREATE TABLE aum_master (
  id               INTEGER PRIMARY KEY,
  am_asset_date    TEXT,
  am_folio_no      TEXT,
  fk_scheme_id     INTEGER,
  am_units         NUMERIC,                    -- RTA-reported
  calculated_units NUMERIC,                    -- our FIFO
  am_difference    NUMERIC,
  am_status        INTEGER,                    -- 1 Matching 2 Mismatched 3 Missing 4 Absent
  aum_rta          INTEGER,                    -- 1 CAMS 2 Karvy
  am_remarks       TEXT
);

CREATE TABLE aum_import_status (
  id                  INTEGER PRIMARY KEY,
  aum_date            TEXT,
  expected_file_count INTEGER DEFAULT 3,
  current_file_count  INTEGER DEFAULT 0,
  status              TEXT
);

CREATE TABLE aum_reco_ignore_list (
  id        INTEGER PRIMARY KEY,
  folio_no  TEXT, scheme_id INTEGER,
  created_at TEXT
);

CREATE TABLE file_history (
  id              INTEGER PRIMARY KEY,
  name            TEXT,
  file_source     TEXT,                        -- CAMS | KARVY | R2A | BSE
  file_type       TEXT,                        -- TRANSACTION | FOLIO | AUM | SXP | BROKERAGE
  upload_date     TEXT,
  is_error        INTEGER DEFAULT 0,
  is_imported     INTEGER DEFAULT 0,
  is_processed    INTEGER DEFAULT 0,
  total_transactions INTEGER,
  error_message   TEXT,
  uploaded_by     INTEGER,
  is_r2a          INTEGER DEFAULT 0
);

CREATE TABLE client_kyc_logs (
  id              INTEGER PRIMARY KEY,
  fk_clm_id       INTEGER,
  name            TEXT, mobile_no TEXT, pan_no TEXT, dob TEXT,
  request_id      TEXT,
  status          TEXT,                        -- internal workflow
  kra_status      TEXT,
  kra_status_code TEXT,
  bse_status      TEXT,
  rejection_level TEXT,
  kyc_type        TEXT,
  is_digio        INTEGER DEFAULT 0,
  kyc_linked      INTEGER DEFAULT 0,
  entry_date      TEXT,
  modification_date TEXT
);

CREATE TABLE kra_error_codes (
  id                INTEGER PRIMARY KEY,
  error_code        TEXT UNIQUE,
  error_description TEXT
);

------------------------------------------------------------------------------
-- SECTION 6 · CARRIED — brokerage & invoices (brok DB tables, same names)
------------------------------------------------------------------------------

CREATE TABLE brokerage_type_master (
  brk_type_id   INTEGER PRIMARY KEY,
  brk_type_name TEXT NOT NULL                  -- Trail | Upfront | Incentive | Clawback
);

CREATE TABLE broker_category_payout_pct_master (
  payout_id         INTEGER PRIMARY KEY,
  fk_sb_category_id INTEGER REFERENCES sub_broker_category_master(cat_id),
  fk_asset_id       INTEGER,
  trail_1st_yr_pct  NUMERIC,                   -- flat tier % today (Silver 60 … Platinum 90)
  upfront_pct       NUMERIC,
  b30_incentive_pct NUMERIC,
  from_date         TEXT, to_date TEXT,
  is_active         INTEGER DEFAULT 1
);

CREATE TABLE brokerage_master (
  bkr_id            INTEGER PRIMARY KEY,
  bkr_folio_no      TEXT,
  fk_scheme_id      INTEGER,
  fk_folio_id       INTEGER,
  fk_sb_id          INTEGER,
  fk_bkr_type_id    INTEGER REFERENCES brokerage_type_master(brk_type_id),
  bkr_from_date     TEXT, bkr_to_date TEXT,
  bkr_units         NUMERIC,
  tr_amount         NUMERIC,                   -- AUM base for the period
  bkr_percentage    NUMERIC,                   -- rate the AMC paid (annualised %)
  bkr_amount        NUMERIC,                   -- commission received
  bkr_payout_rate_precentage NUMERIC,          -- [sic] tier share %
  bkr_payout_amount NUMERIC,
  payout_gst_amount NUMERIC DEFAULT 0,
  payout_tds        NUMERIC DEFAULT 0,
  has_gst           INTEGER DEFAULT 0,
  fk_invoice_id     INTEGER,
  calc_units        NUMERIC, calc_tr_amount NUMERIC,
  calc_rate         NUMERIC, calc_brok_amount NUMERIC,
  reco_status       INTEGER DEFAULT 0,
  reco_difference   NUMERIC DEFAULT 0,
  reco_remarks      TEXT,
  is_freezed        INTEGER DEFAULT 0,
  clawback_source_txn INTEGER                  -- NEW column: cause link for clawbacks
);
CREATE INDEX idx_bm_sb_period ON brokerage_master(fk_sb_id, bkr_from_date);

CREATE TABLE gst_master (
  gst_id INTEGER PRIMARY KEY,
  gst_percentage NUMERIC DEFAULT 18.0,
  from_date TEXT, to_date TEXT
);

CREATE TABLE invoice_master (
  invoice_id        INTEGER PRIMARY KEY,
  invoice_no        TEXT UNIQUE,               -- MF/26-27/NNNN
  fk_sb_id          INTEGER,
  invoice_date      TEXT,
  period_start_date TEXT, period_end_date TEXT,
  sub_total         NUMERIC,
  cgst NUMERIC, sgst NUMERIC, tds NUMERIC,
  total_amount      NUMERIC,
  payment_date      TEXT
);

CREATE TABLE invoice_data (
  invoice_data_id INTEGER PRIMARY KEY,
  fk_invoice_id   INTEGER REFERENCES invoice_master(invoice_id),
  brk_type_id     INTEGER,
  payout_amount   NUMERIC, gst_amount NUMERIC, net_amount NUMERIC
);

CREATE TABLE brokerage_payout_queue (
  id           INTEGER PRIMARY KEY,
  from_date    TEXT, to_date TEXT,
  requested_by INTEGER,
  status       INTEGER DEFAULT 0,
  is_reprocess INTEGER DEFAULT 0,
  approved_by  INTEGER,                        -- NEW column: maker-checker (ASSUMPTION flagged)
  approved_at  TEXT
);

CREATE TABLE sb_fy_brokerage_tracker (
  id                INTEGER PRIMARY KEY,
  fk_sb_id          INTEGER,
  financial_year    TEXT,                      -- '26-27'
  cumulative_payout NUMERIC DEFAULT 0,
  threshold_crossed INTEGER DEFAULT 0,
  crossing_month    TEXT
);

CREATE TABLE download_history_logs (
  id           INTEGER PRIMARY KEY,
  user_id      INTEGER,
  pdf_type     TEXT,                          -- report id from lib/reports.ts
  format       TEXT DEFAULT 'pdf',            -- pdf (for a client) | xlsx (to work on)
  params       TEXT,                          -- pg: jsonb — the filters the run used
  row_count    INTEGER,
  status       TEXT DEFAULT 'PENDING',        -- PENDING | RUNNING | COMPLETED | FAILED
  file_url     TEXT,
  report_for   TEXT,
  is_broker    INTEGER DEFAULT 0,
  requested_at TEXT, completed_at TEXT,
  -- Production expires downloads after 7 days; the column makes that a fact
  -- rather than a convention buried in a cron job.
  expires_at   TEXT
);

------------------------------------------------------------------------------
-- SECTION 7 · NEW — the organism (foundation, 6 objects)
------------------------------------------------------------------------------

CREATE TABLE events (                          -- THE LEDGER. Append-only.
  event_id     INTEGER PRIMARY KEY,
  occurred_at  TEXT NOT NULL,
  actor_type   TEXT NOT NULL,                  -- user | agent | system | client
  actor_id     TEXT,
  subject_type TEXT NOT NULL,                  -- client | folio | sip | order | action | broker | campaign | application | workflow
  subject_id   TEXT NOT NULL,
  event_type   TEXT NOT NULL,
  payload      TEXT,                           -- pg: jsonb
  source       TEXT                            -- import | ui | api | agent
);
CREATE INDEX idx_ev_subject ON events(subject_type, subject_id, occurred_at);
CREATE INDEX idx_ev_type    ON events(event_type, occurred_at);
-- pg: REVOKE UPDATE, DELETE — enforced at role level; SQLite: convention + verify.ts check

CREATE TABLE actions (
  action_id      INTEGER PRIMARY KEY,
  subject_type   TEXT NOT NULL,
  subject_id     TEXT NOT NULL,
  action_type    TEXT NOT NULL,                -- sip_bounce_save | kyc_unstick | dormant_review | tax_window | recon_break | quarantine_fix | …
  trigger_evidence TEXT,                       -- pg: jsonb — the rows that fired, human-readable
  impact_score   NUMERIC,                      -- ₹ at stake
  owner_lens     TEXT NOT NULL,                -- broker | rm | ops | management
  assignee_sb_id INTEGER,
  assignee_user  INTEGER,
  suggested_step TEXT,
  sla_due        TEXT,
  state          TEXT NOT NULL DEFAULT 'proposed',  -- proposed→assigned→in_progress→done|dismissed
  dismiss_reason TEXT,                         -- mandatory when state='dismissed' (CHECK below)
  outcome_type   TEXT,                         -- saved | executed | client_declined | no_response | auto_resolved | …
  outcome_value  TEXT,                         -- pg: jsonb
  created_from   TEXT,                         -- rule:<id> | campaign:<id> | manual
  -- pg: bigint[] — the transactions this action actually caused. Only set when a
  -- human names them on closing, which is what makes campaign ROI provable rather
  -- than a correlation over a time window.
  linked_txn_ids TEXT,
  created_at     TEXT NOT NULL,
  closed_at      TEXT,
  CHECK (state != 'dismissed' OR dismiss_reason IS NOT NULL)
);
CREATE INDEX idx_ac_assignee ON actions(assignee_sb_id, state, sla_due);

CREATE TABLE rules_registry (
  rule_id       INTEGER PRIMARY KEY,
  rule_key      TEXT NOT NULL,                 -- e.g. 'sip_bounce_x2', 'dormant_months', 'concentration_pct'
  name          TEXT,
  definition_sql TEXT,
  params        TEXT,                          -- pg: jsonb — thresholds
  version       INTEGER NOT NULL DEFAULT 1,
  owner         TEXT,
  approved_by   TEXT,
  is_active     INTEGER DEFAULT 1,
  valid_from    TEXT,
  UNIQUE (rule_key, version)
);

CREATE TABLE policies (
  policy_id   INTEGER PRIMARY KEY,
  workflow    TEXT NOT NULL,                   -- sip_save | kyc_unblock | dormant_reactivation | …
  policy_key  TEXT NOT NULL,                   -- e.g. 'nudge_framing', 'escalation_day'
  belief      TEXT,                            -- pg: jsonb — current best choice + weights
  evidence_n  INTEGER DEFAULT 0,
  target_n    INTEGER DEFAULT 200,             -- honesty threshold: ghosted below this
  version     INTEGER DEFAULT 1,
  changed_at  TEXT,
  changed_by  TEXT,
  approved_by TEXT,
  UNIQUE (workflow, policy_key, version)
);

CREATE TABLE experiments (
  experiment_id INTEGER PRIMARY KEY,
  workflow      TEXT NOT NULL,
  variants      TEXT NOT NULL,                 -- pg: jsonb — pre-approved set only
  allocation    TEXT,
  status        TEXT DEFAULT 'draft',          -- draft→approved→running→concluded
  approved_by   TEXT,
  started_at    TEXT, concluded_at TEXT
);

CREATE TABLE interactions (
  interaction_id INTEGER PRIMARY KEY,
  client_id      INTEGER NOT NULL REFERENCES client_master(cm_user_id),
  sb_id          INTEGER,
  kind           TEXT NOT NULL,                -- voice | doc | note | call | meeting
  media_ref      TEXT,
  transcript     TEXT,
  structured     TEXT,                         -- pg: jsonb
  minted_action_id INTEGER REFERENCES actions(action_id),
  occurred_at    TEXT NOT NULL
);

CREATE TABLE consents (
  consent_id  INTEGER PRIMARY KEY,
  client_id   INTEGER NOT NULL REFERENCES client_master(cm_user_id),
  channel     TEXT NOT NULL,                   -- whatsapp | email | sms
  purpose     TEXT NOT NULL,                   -- transactional | marketing
  state       TEXT NOT NULL DEFAULT 'granted', -- granted | withdrawn
  captured_via TEXT,
  ts          TEXT NOT NULL,
  UNIQUE (client_id, channel, purpose)
);

------------------------------------------------------------------------------
-- SECTION 8 · NEW — onboarding, marketing, earnings-trust, ops (16 objects)
------------------------------------------------------------------------------

CREATE TABLE leads (
  lead_id     INTEGER PRIMARY KEY,
  source      TEXT NOT NULL,                   -- link | referral | campaign | walk_in | manual
  sb_id       INTEGER,
  name        TEXT, mobile TEXT, email TEXT,
  consent_state TEXT DEFAULT 'unknown',
  stage       TEXT DEFAULT 'new',              -- new→contacted→onboarding→converted|lost
  created_at  TEXT,
  converted_client_id INTEGER
);

CREATE TABLE onboarding_applications (
  application_id  INTEGER PRIMARY KEY,
  lead_id         INTEGER REFERENCES leads(lead_id),
  client_id       INTEGER,
  sb_id           INTEGER,
  channel         TEXT NOT NULL,               -- digital | offline
  holding_type    TEXT DEFAULT 'Single',
  digio_request_id TEXT,
  kyc_log_id      INTEGER REFERENCES client_kyc_logs(id),
  kyc_status      TEXT,
  kra_status      TEXT,
  bse_status      TEXT,
  elog_status     TEXT,                        -- pending | sent | completed | stalled
  ucc_status      TEXT,
  stall_since     TEXT,
  started_at      TEXT,
  completed_at    TEXT
);

CREATE TABLE broker_links (
  link_id     INTEGER PRIMARY KEY,
  sb_id       INTEGER NOT NULL REFERENCES sub_broker_master(sb_id),
  slug        TEXT UNIQUE,
  campaign_id INTEGER,
  created_at  TEXT,
  expires_at  TEXT,
  visits      INTEGER DEFAULT 0,
  applications INTEGER DEFAULT 0
);

CREATE TABLE segments (
  segment_id INTEGER PRIMARY KEY,
  name       TEXT NOT NULL,
  owner      TEXT,
  definition TEXT NOT NULL,                    -- pg: jsonb — filter spec
  is_shared  INTEGER DEFAULT 0,
  created_at TEXT
);

CREATE TABLE campaign_templates (
  template_id           INTEGER PRIMARY KEY,
  name                  TEXT,
  creative_ref          TEXT,
  disclaimers_injected  INTEGER DEFAULT 1,
  approval_artefact_ref TEXT,                  -- stored written approval (AMFI gate)
  approved_by           TEXT,
  approved_at           TEXT
);

CREATE TABLE campaigns (
  campaign_id INTEGER PRIMARY KEY,
  template_id INTEGER REFERENCES campaign_templates(template_id),
  name        TEXT,
  segment_id  INTEGER REFERENCES segments(segment_id),
  mode        TEXT NOT NULL,                   -- through_broker | direct
  state       TEXT DEFAULT 'draft',
  launched_at TEXT
);

CREATE TABLE campaign_sends (
  send_id     INTEGER PRIMARY KEY,
  campaign_id INTEGER NOT NULL REFERENCES campaigns(campaign_id),
  client_id   INTEGER NOT NULL,
  sb_id       INTEGER,
  channel     TEXT,
  sent_at     TEXT,
  delivery_state TEXT
);

CREATE TABLE campaign_responses (
  response_id   INTEGER PRIMARY KEY,
  send_id       INTEGER NOT NULL REFERENCES campaign_sends(send_id),
  response_type TEXT,
  responded_at  TEXT,
  minted_action_id INTEGER REFERENCES actions(action_id)
);

CREATE TABLE payout_disputes (
  dispute_id  INTEGER PRIMARY KEY,
  sb_id       INTEGER NOT NULL,
  brokerage_row_refs TEXT,                     -- pg: bigint[] — bkr_id list
  reason      TEXT,
  state       TEXT DEFAULT 'open',
  raised_at   TEXT,
  resolved_at TEXT,
  resolution_note TEXT,
  action_id   INTEGER REFERENCES actions(action_id)
);

CREATE TABLE review_packs (
  pack_id      INTEGER PRIMARY KEY,
  client_id    INTEGER NOT NULL,
  sb_id        INTEGER,
  generated_at TEXT,
  content_ref  TEXT,
  sent_via     TEXT,
  client_response TEXT,
  action_ids   TEXT                            -- pg: bigint[]
);

CREATE TABLE risk_allocation_bands (           -- schema now; rows pending compliance
  band_id      INTEGER PRIMARY KEY,
  risk_profile TEXT NOT NULL,
  asset_class  TEXT NOT NULL,
  min_pct NUMERIC, max_pct NUMERIC,
  version      INTEGER DEFAULT 1,
  approved_by  TEXT
);

CREATE TABLE amc_rate_card (                   -- commercial-terms validator truth side
  card_id          INTEGER PRIMARY KEY,
  amc_id           INTEGER NOT NULL REFERENCES amc_master(amc_id),
  scheme_category  TEXT,
  agreed_trail_bps NUMERIC NOT NULL,
  effective_from   TEXT, effective_to TEXT,
  source_doc_ref   TEXT,
  entered_by TEXT, approved_by TEXT
);

CREATE TABLE import_runs (
  run_id      INTEGER PRIMARY KEY,
  source      TEXT NOT NULL,                   -- cams | kfin | r2a
  window_from TEXT, window_to TEXT,
  state       TEXT DEFAULT 'fetched',          -- fetched→landed→enriched→promoted|failed
  started_at  TEXT, finished_at TEXT,
  row_counts  TEXT                             -- pg: jsonb — before/after per step
);

CREATE TABLE quarantine_rows (
  q_id            INTEGER PRIMARY KEY,
  run_id          INTEGER REFERENCES import_runs(run_id),
  file_history_id INTEGER,
  raw_row         TEXT NOT NULL,               -- pg: jsonb
  reason          TEXT NOT NULL,               -- unknown_scheme | unknown_client | unknown_type | dup_suspect
  state           TEXT DEFAULT 'open',         -- open→mapped→reprocessed|ignored
  resolved_by     TEXT,
  action_id       INTEGER REFERENCES actions(action_id),
  created_at      TEXT
);

CREATE TABLE saved_queries (
  query_id    INTEGER PRIMARY KEY,
  name        TEXT NOT NULL,
  question_text TEXT,
  sql         TEXT NOT NULL,
  params      TEXT,                            -- pg: jsonb
  verified_by TEXT,
  visibility  TEXT DEFAULT 'mgmt',
  last_run_at TEXT
);

-- Matview-equivalents: TABLES refreshed by the seed/refresh job (matches prod pattern).

-- The AUM spine. Both exist in production; the mock rebuilds them from the same
-- folio walk that generates commission, so the trend on My business and the money
-- on My earnings are the same book by construction, not two series that drift.
CREATE TABLE mv_aum_daily (
  aum_date     TEXT NOT NULL,
  sb_id        INTEGER NOT NULL,
  client_count INTEGER,
  folio_count  INTEGER,
  aum          NUMERIC,
  PRIMARY KEY (aum_date, sb_id)
);

-- Monthly rollup. `peak_day_aum` is the firm's reported definition (ruling 7:
-- peak-day stays, and every monthly figure must state which definition it uses).
-- `month_end_aum` is carried alongside because only month-end makes the growth
-- identity hold exactly: opening + net_flows + market_movement = closing.
CREATE TABLE mv_monthly_aum (
  month           TEXT NOT NULL,
  sb_id           INTEGER NOT NULL,
  peak_day_aum    NUMERIC,
  peak_date       TEXT,
  month_end_aum   NUMERIC,
  opening_aum     NUMERIC,
  net_flows       NUMERIC,
  market_movement NUMERIC,
  client_count    INTEGER,
  PRIMARY KEY (month, sb_id)
);

CREATE TABLE mv_portfolio_attention (
  client_id    INTEGER NOT NULL,
  flag_type    TEXT NOT NULL,                  -- laggard | stale | concentration | drift | bottom_percentile
  severity     TEXT,
  evidence     TEXT,                           -- pg: jsonb
  rule_version INTEGER,
  as_of        TEXT
);

CREATE TABLE mv_workflow_health (
  workflow           TEXT PRIMARY KEY,
  goal_metric_name   TEXT,
  goal_metric_value  NUMERIC,
  trend_30d          NUMERIC,
  in_flight          INTEGER,
  sla_pct            NUMERIC,
  brain_status       TEXT,                     -- preset | learning | learned
  evidence_n         INTEGER,
  last_policy_change TEXT,
  as_of              TEXT
);

CREATE TABLE mv_broker_scorecard (
  sb_id          INTEGER NOT NULL,
  month          TEXT NOT NULL,
  net_flows      NUMERIC,
  sip_live_count INTEGER,
  sip_live_value NUMERIC,
  bounce_rate    NUMERIC,
  clients_gained INTEGER,
  clients_lost   INTEGER,
  action_sla_pct NUMERIC,
  PRIMARY KEY (sb_id, month)
);

CREATE TABLE mv_integration_health (
  integration     TEXT PRIMARY KEY,            -- bse | cams | kfin | digio | morningstar
  last_success_at TEXT,
  lag_hours       NUMERIC,
  error_streak    INTEGER DEFAULT 0,
  as_of           TEXT
);

CREATE TABLE mv_nominee_payouts (
  sb_id         INTEGER PRIMARY KEY,
  terminated_on TEXT,
  nominee       TEXT,
  months_paid   INTEGER,
  total_paid    NUMERIC,
  as_of         TEXT
);

------------------------------------------------------------------------------
-- SECTION 9 · Serving VIEWS (pure projections — disposable by design)
------------------------------------------------------------------------------

CREATE VIEW mv_brokerage_summary AS
SELECT bm.fk_sb_id                                   AS sb_id,
       substr(bm.bkr_from_date, 1, 7)                AS month,
       SUM(CASE WHEN bt.brk_type_name='Trail'    THEN bm.bkr_amount ELSE 0 END) AS trail_amount,
       SUM(CASE WHEN bt.brk_type_name='Upfront'  THEN bm.bkr_amount ELSE 0 END) AS upfront_amount,
       SUM(CASE WHEN bt.brk_type_name='Incentive'THEN bm.bkr_amount ELSE 0 END) AS incentive_amount,
       SUM(CASE WHEN bt.brk_type_name='Clawback' THEN bm.bkr_amount ELSE 0 END) AS clawback_amount,
       SUM(bm.bkr_amount)                            AS received_total,
       SUM(bm.bkr_payout_amount)                     AS payout_amount,
       SUM(bm.bkr_payout_amount + bm.payout_gst_amount - bm.payout_tds) AS payout_net_amount
FROM brokerage_master bm
JOIN brokerage_type_master bt ON bt.brk_type_id = bm.fk_bkr_type_id
GROUP BY bm.fk_sb_id, substr(bm.bkr_from_date, 1, 7);

CREATE VIEW mv_duplicate_folios AS
SELECT tm.tr_folio_no, tm.fk_scheme_id,
       COUNT(DISTINCT tm.fk_sb_id) AS broker_count,
       GROUP_CONCAT(DISTINCT tm.fk_sb_id) AS sb_ids
FROM transaction_master tm
WHERE tm.fk_txn_status_id = 2 AND tm.is_active = 1
GROUP BY tm.tr_folio_no, tm.fk_scheme_id
HAVING COUNT(DISTINCT tm.fk_sb_id) > 1;

CREATE VIEW v_client_value AS                  -- helper: current value per client
SELECT client_id, SUM(present_market_value) AS value_now
FROM fifo_summary_holding_active
GROUP BY client_id;

CREATE VIEW v_broker_book AS                   -- helper: current book per broker code
SELECT advisor_code, SUM(present_market_value) AS book_value, COUNT(DISTINCT client_id) AS clients
FROM fifo_summary_holding_active
GROUP BY advisor_code;

-- Goals. `transaction_master.fk_goal_id` has always pointed here; the table
-- itself did not exist until the client lens needed a denominator that is not
-- rupees. A goal owns the schemes whose transactions carry its id, so progress
-- is read off the same fifo holdings every other page prices from.
CREATE TABLE client_goals (
  goal_id       INTEGER PRIMARY KEY,
  fk_cm_user_id INTEGER NOT NULL REFERENCES client_master(cm_user_id),
  goal_name     TEXT NOT NULL,
  goal_kind     TEXT,                          -- education | retirement | home | freedom | other
  target_amount NUMERIC NOT NULL,
  target_date   TEXT NOT NULL,
  created_at    TEXT,
  is_active     INTEGER DEFAULT 1,
  -- A goal the household owns rather than one person. Funded by whichever
  -- members' transactions carry its id, so it is still one denominator.
  is_family     INTEGER DEFAULT 0
);
CREATE INDEX idx_goal_client ON client_goals(fk_cm_user_id, is_active);

-- ── Held away (MF Central / CAS seam) ───────────────────────────────────────
-- Folios the client holds somewhere else, fetched against their PAN. This is
-- what turns the app from "your Jhaveri folios" into "your money".
--
-- Note what this table does NOT have: a value column. Units and a scheme id are
-- stored; the rupee figure is units × the same `mf_latest_price_master` price
-- every Jhaveri holding is priced from, computed at read time. A held-away fund
-- and an advised fund can therefore never disagree about a price, which is the
-- single most likely way a consolidated net worth goes quietly wrong.
--
-- `fk_scheme_id` is nullable on purpose. An RTA sends schemes from houses we do
-- not distribute, and a row we cannot price must render a dash and be counted as
-- unpriced — never silently valued at zero, which would understate a net worth
-- while every total still added up.
CREATE TABLE heldaway_folios (
  ha_id        INTEGER PRIMARY KEY,
  pan_no       TEXT NOT NULL,
  client_id    INTEGER REFERENCES client_master(cm_user_id),
  folio_no     TEXT NOT NULL,
  fk_scheme_id INTEGER REFERENCES scheme_master(scheme_id),
  scheme_name  TEXT NOT NULL,                 -- as the RTA spells it, not as we do
  amc_name     TEXT NOT NULL,
  amfi_code    TEXT,                          -- what we match on
  units        NUMERIC NOT NULL,
  cost_amount  NUMERIC,
  rta          TEXT,                          -- CAMS | KFintech
  first_seen   TEXT NOT NULL,
  as_of        TEXT NOT NULL,
  source       TEXT NOT NULL DEFAULT 'mfcentral',
  -- The natural key. A CAS is re-fetched every month and would otherwise double
  -- a client's net worth on the second import.
  UNIQUE (pan_no, folio_no, scheme_name)
);
CREATE INDEX idx_ha_client ON heldaway_folios(client_id);

-- ── Fund intelligence (Morningstar seam) ────────────────────────────────────
-- Everything here would arrive from Morningstar in the live build. It does not
-- exist yet, so it is seeded — but the seed is split honestly by `source`:
--   computed — derived from NAV history and holdings already in this database,
--              and therefore true. Swapping in the vendor feed should not move it.
--   seeded   — vendor content we cannot derive (a manager's name, a philosophy,
--              a commentary). A stand-in, and every screen that shows it says so.
-- No row is allowed to be silent about which it is.

CREATE TABLE fund_manager (
  manager_id     INTEGER PRIMARY KEY,
  full_name      TEXT NOT NULL,
  managing_since TEXT,                        -- first year they ran money anywhere
  qualification  TEXT,
  philosophy     TEXT NOT NULL,               -- how they say they invest
  source         TEXT NOT NULL DEFAULT 'seeded'
);

-- Who has run a fund, and when. A history rather than a column, because "the
-- manager changed eleven months ago" is the single most useful fact about a
-- three-year record and a current-manager column cannot hold it.
CREATE TABLE scheme_manager (
  sm_id         INTEGER PRIMARY KEY,
  fk_scheme_id  INTEGER NOT NULL REFERENCES scheme_master(scheme_id),
  fk_manager_id INTEGER NOT NULL REFERENCES fund_manager(manager_id),
  from_date     TEXT NOT NULL,
  to_date       TEXT,                         -- NULL = still running it
  role          TEXT NOT NULL DEFAULT 'lead', -- lead | co
  source        TEXT NOT NULL DEFAULT 'seeded'
);
CREATE INDEX idx_sm_scheme ON scheme_manager(fk_scheme_id, from_date);

CREATE TABLE manager_commentary (
  commentary_id INTEGER PRIMARY KEY,
  fk_manager_id INTEGER NOT NULL REFERENCES fund_manager(manager_id),
  fk_scheme_id  INTEGER REFERENCES scheme_master(scheme_id),
  as_of         TEXT NOT NULL,
  headline      TEXT NOT NULL,
  body          TEXT NOT NULL,
  source        TEXT NOT NULL DEFAULT 'seeded'
);
CREATE INDEX idx_mc_scheme ON manager_commentary(fk_scheme_id, as_of);

-- The value/growth tilt of a single company. Not derivable from anything this
-- database holds — there are no fundamentals here — so it is seeded per stock
-- and the fund-level score is computed from it against real holding weights.
CREATE TABLE stock_style (
  stock_id     TEXT PRIMARY KEY REFERENCES stock_master(stock_id),
  growth_score NUMERIC NOT NULL,              -- 1 deep value … 3 high growth
  source       TEXT NOT NULL DEFAULT 'seeded'
);

-- The style box, dated, so drift is a line rather than a label.
CREATE TABLE scheme_style (
  ss_id        INTEGER PRIMARY KEY,
  fk_scheme_id INTEGER NOT NULL REFERENCES scheme_master(scheme_id),
  as_of        TEXT NOT NULL,
  size_score   NUMERIC NOT NULL,              -- 1 small … 3 large
  value_score  NUMERIC NOT NULL,              -- 1 value … 3 growth
  box          TEXT NOT NULL,                 -- 'Large Growth', 'Mid Blend', …
  avg_mcap_cr  NUMERIC,
  source       TEXT NOT NULL,
  UNIQUE (fk_scheme_id, as_of)
);

-- What the fund did when the market fell, which is the only half of a record
-- most clients have never been shown.
CREATE TABLE scheme_risk_stats (
  rs_id            INTEGER PRIMARY KEY,
  fk_scheme_id     INTEGER NOT NULL REFERENCES scheme_master(scheme_id),
  as_of            TEXT NOT NULL,
  period_months    INTEGER NOT NULL,
  months_up        INTEGER,
  months_down      INTEGER,
  upside_capture   NUMERIC,
  downside_capture NUMERIC,
  std_dev          NUMERIC,
  sharpe           NUMERIC,
  max_drawdown     NUMERIC,
  -- How closely the fund's monthly moves actually track its index in this data.
  -- Stored because it is the evidence for which figures on this row are real.
  correlation      NUMERIC,
  source           TEXT NOT NULL,
  UNIQUE (fk_scheme_id, period_months, as_of)
);

-- Ratings are stored and DELIBERATELY NOT RENDERED client-side. Redistributing a
-- Morningstar star rating to an investor is a licensing question the founder has
-- not answered yet, and DESIGN.md refuses star ratings on the client lens anyway.
-- The table exists so the answer, when it comes, is a rendering decision.
CREATE TABLE scheme_rating (
  fk_scheme_id INTEGER PRIMARY KEY REFERENCES scheme_master(scheme_id),
  as_of        TEXT NOT NULL,
  star         INTEGER,
  analyst      TEXT,
  provider     TEXT NOT NULL,
  client_visible INTEGER NOT NULL DEFAULT 0
);

-- ── The household ───────────────────────────────────────────────────────────
-- `client_master.fk_family_id` already says who is in a family. It cannot say
-- how they are related, and it cannot hold someone who has no account yet —
-- which is the whole point of a household as an acquisition surface. This table
-- carries exactly those two facts and nothing that is already stored elsewhere:
-- money still comes from fifo_summary_holding_active, keyed on the client id.
CREATE TABLE household_members (
  member_id     INTEGER PRIMARY KEY,
  family_id     INTEGER NOT NULL REFERENCES family_master(family_id),
  -- NULL until they open an account. A named person with no client id is a
  -- prospect the family already knows, not a gap in the data.
  client_id     INTEGER REFERENCES client_master(cm_user_id),
  full_name     TEXT NOT NULL,
  relation      TEXT NOT NULL,                 -- self | spouse | son | daughter | mother | father | huf
  date_of_birth TEXT,
  -- Set while the member is a minor. A guardian sees the account by law, which
  -- is why a minor has no consent rows: there is no question to ask.
  guardian_client_id INTEGER REFERENCES client_master(cm_user_id),
  added_at      TEXT NOT NULL,
  UNIQUE (family_id, full_name)
);
CREATE INDEX idx_hm_family ON household_members(family_id);

-- Who may see whose money, and how much of it. Deliberately not a boolean on
-- the member row: consent is per subject, per viewer, per scope, and it has a
-- state a person can be in the middle of — asked, and not yet answered.
-- A row is required for money to cross between two adults. No row is a refusal.
CREATE TABLE household_consents (
  hc_id       INTEGER PRIMARY KEY,
  family_id   INTEGER NOT NULL REFERENCES family_master(family_id),
  subject_id  INTEGER NOT NULL REFERENCES client_master(cm_user_id),  -- whose money
  viewer_id   INTEGER NOT NULL REFERENCES client_master(cm_user_id),  -- who is asking
  scope       TEXT NOT NULL,                   -- total | holdings
  state       TEXT NOT NULL,                   -- asked | granted | refused | withdrawn
  asked_at    TEXT NOT NULL,
  decided_at  TEXT,
  decided_via TEXT,                            -- app | review meeting | phone
  UNIQUE (family_id, subject_id, viewer_id, scope)
);
