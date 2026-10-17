-- Vanhan sovellusversion dataa (ajetaan ennen uutta migraatiota)
INSERT INTO auth.users (id, email) VALUES ('33333333-3333-3333-3333-333333333333', 'vanha@example.com');
INSERT INTO profiilit (user_id, yritys_nimi, y_tunnus, osoite, iban)
VALUES ('33333333-3333-3333-3333-333333333333', 'Vanha Oy', '7654321-0', 'Katu 2', 'FI2112345600000785');
INSERT INTO asiakkaat (id, user_id, nimi) VALUES
  ('cccccccc-0000-0000-0000-000000000001', '33333333-3333-3333-3333-333333333333', 'Asiakas');
INSERT INTO laskut (id, user_id, asiakas_id, laskunumero, laskupaiva, erapaiva, tila, maksettu_pvm) VALUES
  ('dddddddd-0000-0000-0000-000000000001', '33333333-3333-3333-3333-333333333333',
   'cccccccc-0000-0000-0000-000000000001', '2026-001', '2026-01-15', '2026-01-29', 'maksettu', '2026-01-20'),
  ('dddddddd-0000-0000-0000-000000000002', '33333333-3333-3333-3333-333333333333',
   'cccccccc-0000-0000-0000-000000000001', '2026-002', '2026-01-16', '2026-01-30', 'luonnos', NULL);
INSERT INTO laskurivit (lasku_id, kuvaus, maara, yksikkohinta, alv_kanta) VALUES
  ('dddddddd-0000-0000-0000-000000000001', 'Työ', 2, 50, 25.5),
  ('dddddddd-0000-0000-0000-000000000001', 'Veroton', 1, 10, 0),
  ('dddddddd-0000-0000-0000-000000000002', 'Luonnos', 1, 10, 25.5);
INSERT INTO kulut (user_id, paiva, kuvaus, summa, alv_kanta, kategoria) VALUES
  ('33333333-3333-3333-3333-333333333333', '2026-01-10', 'Lounas', 57, 14, 'Edustuskulut');
