#!/usr/bin/env bash
# One-time pull of a slice of Atlas (the fund manager's system) into a JSON
# snapshot this prototype seeds from. Atlas is a data SOURCE only — nothing in
# this app links to it, and the demo runs offline from the snapshot.
#
# Real build: the same shapes arrive from the AMC portfolio-disclosure feed on a
# schedule, into mf_scheme_holdings + stock_master.
#
# Usage: ./mockdb/extract-atlas.sh   (needs Atlas's ATLAS_DB_URL, read-only)
set -euo pipefail

ATLAS_DIR="${ATLAS_DIR:-$HOME/All AI/atlas-os}"
OUT="$(dirname "$0")/atlas-slice.json"
export $(grep ATLAS_DB_URL "$ATLAS_DIR/.env" | xargs)

psql "$ATLAS_DB_URL" -t -A -o "$OUT" <<'SQL'
WITH latest AS (SELECT MAX(as_of_date) d FROM atlas_foundation.de_mf_holdings),
-- our five equity categories, six real funds each, picked by sector coverage
ranked AS (
  SELECT m.mstar_id, m.fund_name, m.amc_name, m.category_name,
         COUNT(*) FILTER (WHERE i.sector IS NOT NULL) mapped,
         ROW_NUMBER() OVER (PARTITION BY m.category_name
           ORDER BY COUNT(*) FILTER (WHERE i.sector IS NOT NULL) DESC, m.fund_name) rn
  FROM atlas_foundation.de_mf_master m
  JOIN atlas_foundation.de_mf_holdings h ON h.mstar_id = m.mstar_id AND h.as_of_date = (SELECT d FROM latest)
  LEFT JOIN atlas_foundation.instrument_master i ON i.instrument_id = h.instrument_id
  WHERE m.category_name IN ('India Fund Flexi Cap','India Fund Large-Cap','India Fund Mid-Cap',
                            'India Fund Small-Cap','India Fund ELSS (Tax Savings)')
    AND h.weight_pct IS NOT NULL
  GROUP BY m.mstar_id, m.fund_name, m.amc_name, m.category_name
  HAVING COUNT(*) FILTER (WHERE i.sector IS NOT NULL) >= 20
),
picked AS (SELECT * FROM ranked WHERE rn <= 6),
-- market-cap bands: AMFI convention, top 100 large / 101-250 mid / rest small
capped AS (
  SELECT s.instrument_id, s.market_cap,
         ROW_NUMBER() OVER (ORDER BY s.market_cap DESC) mrank
  FROM atlas_foundation.screener_ratios s WHERE s.market_cap IS NOT NULL
),
hold AS (
  SELECT p.mstar_id, i.instrument_id::text stock_id, i.name stock, i.sector, i.industry,
         ROUND(h.weight_pct, 4) weight,
         CASE WHEN c.mrank IS NULL THEN NULL
              WHEN c.mrank <= 100 THEN 'Large'
              WHEN c.mrank <= 250 THEN 'Mid' ELSE 'Small' END cap_band,
         c.market_cap
  FROM picked p
  JOIN atlas_foundation.de_mf_holdings h ON h.mstar_id = p.mstar_id AND h.as_of_date = (SELECT d FROM latest)
  JOIN atlas_foundation.instrument_master i ON i.instrument_id = h.instrument_id
  LEFT JOIN capped c ON c.instrument_id = i.instrument_id
  WHERE h.weight_pct IS NOT NULL AND i.sector IS NOT NULL AND i.sector <> 'Broad Index'
)
SELECT json_build_object(
  'as_of', (SELECT d FROM latest),
  'funds', (SELECT json_agg(json_build_object(
      'mstar_id', p.mstar_id, 'fund_name', p.fund_name, 'amc_name', p.amc_name,
      'category', p.category_name,
      'holdings', (SELECT json_agg(json_build_object(
          'stock_id', h.stock_id, 'stock', h.stock, 'sector', h.sector,
          'industry', h.industry, 'weight', h.weight, 'cap_band', h.cap_band)
          ORDER BY h.weight DESC)
        FROM hold h WHERE h.mstar_id = p.mstar_id))
    ORDER BY p.category_name, p.rn) FROM picked p),
  'stocks', (SELECT json_agg(DISTINCT jsonb_build_object(
      'stock_id', h.stock_id, 'name', h.stock, 'sector', h.sector,
      'industry', h.industry, 'cap_band', h.cap_band, 'market_cap', h.market_cap))
    FROM hold h)
);
SQL

echo "wrote $OUT ($(wc -c < "$OUT" | tr -d ' ') bytes)"
