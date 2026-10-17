\set ON_ERROR_STOP 1
SET ROLE authenticated;
SELECT set_config('request.jwt.claim.sub', '33333333-3333-3333-3333-333333333333', false);
SELECT set_config('request.jwt.claim.aal', 'aal1', false);
SELECT alusta_kirjanpito();
SELECT testi_assert((SELECT laskunumero IS NULL FROM laskut WHERE id = 'dddddddd-0000-0000-0000-000000000002'), 'luonnoksen numero vapautettu');
SELECT testi_assert(kirjaa_vanhat_tiedot() = '{"laskut": 1, "kulut": 1}'::jsonb, 'vanhat kirjattu');
SELECT testi_assert(kirjaa_vanhat_tiedot() = '{"laskut": 0, "kulut": 0}'::jsonb, 'ei kahdesti');
SELECT testi_assert((SELECT summa_verollinen = 135.50 AND maksettu_summa = 135.50 FROM laskut
                     WHERE id = 'dddddddd-0000-0000-0000-000000000001'), 'vanhan laskun summat (0 % säilyy)');
SELECT testi_assert((SELECT alv_summa = 7.00 AND NOT alv_vahennys FROM kulut WHERE kuvaus = 'Lounas'), 'edustus ei ALV-vähennystä');
UPDATE profiilit SET postinumero = '00100' WHERE user_id = auth.uid();
SELECT laheta_lasku('dddddddd-0000-0000-0000-000000000002');
SELECT testi_assert((SELECT laskunumero FROM laskut WHERE id = 'dddddddd-0000-0000-0000-000000000002') = '2026-002', 'numerointi jatkuu');
SELECT testi_assert((SELECT sum(loppusaldo) = 0 FROM tilisaldot('2026-01-01', '2026-12-31')), 'täsmää');
RESET ROLE;
