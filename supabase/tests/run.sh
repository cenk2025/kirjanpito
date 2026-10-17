#!/usr/bin/env bash
# Ajaa migraatiot ja testit paikallista PostgreSQL:ää vasten (ei Supabasea).
# Käyttö: PGHOST=... PGUSER=postgres ./supabase/tests/run.sh
set -euo pipefail
cd "$(dirname "$0")/../.."
DB=${TEST_DB:-kirjanpito_test}
dropdb --if-exists "$DB"
createdb "$DB"
psql -v ON_ERROR_STOP=1 -q -d "$DB" -f supabase/tests/00_supabase_stub.sql
# Vanha skeema + vanhan version dataa, sitten uudet migraatiot
MIGRAATIOT=(supabase/migrations/*.sql)
psql -v ON_ERROR_STOP=1 -q -d "$DB" -f "${MIGRAATIOT[0]}"
psql -v ON_ERROR_STOP=1 -q -d "$DB" -f supabase/tests/05_vanha_data.sql
for f in "${MIGRAATIOT[@]:1}"; do
  psql -v ON_ERROR_STOP=1 -q -d "$DB" -f "$f"
done
# Ajetaan uusin migraatio toiseen kertaan: idempotenssin tarkistus
psql -v ON_ERROR_STOP=1 -q -d "$DB" -f "$(ls supabase/migrations/*.sql | tail -1)"
psql -v ON_ERROR_STOP=1 -q -o /dev/null -d "$DB" -f supabase/tests/10_kirjanpito_test.sql
psql -v ON_ERROR_STOP=1 -q -o /dev/null -d "$DB" -f supabase/tests/20_vanha_data_test.sql
echo "OK: kaikki tietokantatestit läpäisty"
