-- Update peak MMR / IGN / position for the current roster (178 players).
--
-- WHY SQL AND NOT THE APP: register_players() does
--     peak_mmr = greatest(players.peak_mmr, excluded.peak_mmr)
-- so it only ever RAISES MMR. Every change in this roster is a DECREASE
-- (several fix typos like 90000 -> 11000), so pasting it into the app would
-- silently do nothing. This script sets peak_mmr directly.
--
-- SAFETY: lr_events is NEVER touched. Earned/lost LR is preserved exactly;
-- only the seed (starting_lr) and the cached total (lr) are recomputed as
--     lr = starting_lr + SUM(lr_events.delta)
--
-- Players NOT in this list are left completely untouched.
--
-- Keep the CASE below in sync with BANDS in src/lib/lr.ts.

BEGIN;

DROP TABLE IF EXISTS players_backup_mmr;
CREATE TABLE players_backup_mmr AS SELECT * FROM players;

CREATE TEMP TABLE roster(email text primary key, ign text, mmr int, position smallint);
INSERT INTO roster(email, ign, mmr, position) VALUES
  ('ramirezjoyemmanuel@gmail.com', 'PMA', 4500, 1),
  ('jnwstr14@gmail.com', 'Bihaku', 3200, 5),
  ('nightshiner45@gmail.com', 'th1', 6000, 5),
  ('jkieth567@gmail.com', 'ELoy', 7000, 3),
  ('kimjeruyao@gmail.com', 'Noblesse', 4000, 1),
  ('calvinlaranang32@gmail.com', 'Zxc (cal)', 11000, 2),
  ('spur7up2@gmail.com', 'TonYa', 4900, 5),
  ('gamerbabyd@gmail.com', 'BBD', 6500, 1),
  ('aceancajas@gmail.com', 'Tewsss', 7500, 2),
  ('piayojulmar37@gmail.com', 'Paksss', 6500, 2),
  ('jayjaytamayao1@gmail.com', 'tams', 6000, 4),
  ('rickinganeng23@gmail.com', 'Pineapple', 3700, 5),
  ('anamjul3@gmail.com', 'ali', 9000, 2),
  ('centenomonicajean599@gmail.com', 'Kelslsls', 7500, 1),
  ('johngil120529@gmail.com', 'ezdotes145', 5400, 1),
  ('aeriolb06@gmail.com', 'Kasu', 6754, 2),
  ('rhadel100@gmail.com', 'ahdel', 7200, 2),
  ('rarasteam2@gmail.com', 'rara', 5800, 5),
  ('angelo.miip@gmail.com', 'gotthejuice', 6850, 1),
  ('ariesgamboa006@gmail.com', 'Rhys', 4500, 4),
  ('arcgodwardenzxc@gmail.com', 'Dexy', 8900, 1),
  ('joemarthybanez25@gmail.com', 'popeye', 5000, 1),
  ('xguardian24x@gmail.com', 'Garp', 2800, 4),
  ('leesungkyung20@gmail.com', 'Brute', 2645, 5),
  ('fimpelaez@gmail.com', 'Fimate', 3800, 4),
  ('marcchristianis01@gmail.com', 'Zhenya', 5723, 5),
  ('drdenura30@gmail.com', 'Lylee', 4100, 5),
  ('nicaluce36@gmail.com', 'C', 6442, 2),
  ('bunaoalghani@gmail.com', 'EY-BI', 5000, 1),
  ('sorrondax@gmail.com', 'xanxan', 7500, 1),
  ('arroyonoah37@gmail.com', 'GON', 7000, 2),
  ('julanam00@gmail.com', 'jana.wya', 3000, 5),
  ('randolfjr.nicandro@gmail.com', '^Lala', 6000, 1),
  ('carabantesj1995@gmail.com', 'Kaizen', 5500, 2),
  ('teacherchiko26@gmail.com', 'chqx', 3500, 5),
  ('earvinjohn15@gmail.com', 'Kise', 6700, 1),
  ('zmob666@gmail.com', 'vit', 8500, 2),
  ('fadegaaaming@gmail.com', 'Lukasbaby', 3500, 3),
  ('merbepangcat3@gmail.com', 'Merbs', 8000, 2),
  ('ispy0406@gmail.com', '^^', 7500, 5),
  ('cm.jason1996@gmail.com', 'Reaper', 6000, 4),
  ('edmelarugay05@gmail.com', 'edd', 7000, 5),
  ('jsnalejandro420@gmail.com', 'zxc(player)', 5800, 4),
  ('blackwizard541@gmail.com', 'SQ', 8000, 1),
  ('thp.jan14@gmail.com', 'Instinct', 9000, 1),
  ('asianoppa22@gmail.com', 'Cowguy', 5000, 3),
  ('arvok24@gmail.com', 'AJ', 7000, 2),
  ('itscjoffcl@gmail.com', 'schander', 8000, 2),
  ('jpcorneliuslarita@gmail.com', 'Mystery', 9000, 3),
  ('johnlester.damole67@gmail.com', 'DOMA', 4587, 3),
  ('francenasher@gmail.com', 'nashDoto', 8600, 1),
  ('mbaranas1@gmail.com', 'Uni', 6000, 3),
  ('cruzallanpaul670@gmail.com', 'paul', 8000, 1),
  ('jakoleroofficial@gmail.com', 'Yuuki', 3500, 4),
  ('cliv1220001@gmail.com', 'euruuu', 6000, 2),
  ('magatwally@gmail.com', 'Ciao', 5000, 4),
  ('ampigandre1107@gmail.com', 'Akane', 6800, 1),
  ('raijinboy59@gmail.com', 'Arghh', 7500, 1),
  ('malco.keno15@gmail.com', 'Kenuuu', 9500, 4),
  ('davidjrmambrebe@gmail.com', 'okbu', 5000, 3),
  ('timbasroxanne79@gmail.com', 'Ching', 4100, 3),
  ('kennethjohnbanglos@gmail.com', 'Beks', 4500, 4),
  ('decenajem3@gmail.com', 'Jem', 5900, 3),
  ('jayce050201@gmail.com', 'Jayce', 4080, 4),
  ('suejoseph97777@gmail.com', 'Aim', 2100, 4),
  ('shaging07@gmail.com', 'sheeeey.uwu', 3700, 5),
  ('daryljerusalem181818@gmail.com', 'DA', 4200, 1),
  ('hrsunhaze00@gmail.com', 'cookiz', 4100, 2),
  ('ashpaulpojas21@gmail.com', 'jaspo', 6000, 1),
  ('aaronsarez69@gmail.com', '^^ (asdzxcqwe11)', 7000, 5),
  ('amekameha9@gmail.com', 'PIZZA', 3700, 1),
  ('valcortez147@gmail.com', 'raia', 11000, 1),
  ('ricsonboyon161@gmail.com', 'Ricson', 13000, 1),
  ('quilaomarkchristianp@gmail.com', 'Daddy Sunny', 5000, 3),
  ('brixxiepatotie123@gmail.com', 'Froggo', 6400, 3),
  ('giovanni.nevilos@gmail.com', 'Boss Atan', 3913, 5),
  ('mkmegakart@gmail.com', 'Chi', 6000, 1),
  ('draizen.bernal024@gmail.com', 'Hope', 4300, 5),
  ('soldevillajhamila@gmail.com', 'Perci', 5600, 1),
  ('bookkeeping720@gmail.com', 'Kairi', 4500, 1),
  ('fitzmagbanua@gmail.com', 'Qt', 3800, 4),
  ('shinobi12312@gmail.com', 'Feliv', 1800, 4),
  ('juliepadilla282@gmail.com', 'asamax', 6200, 1),
  ('acosta.raymarc@gmail.com', 'RM', 3500, 1),
  ('aleccasaje@gmail.com', 'A', 5000, 3),
  ('jimshaydiaries@gmail.com', 'Itsjim', 4500, 1),
  ('mjimlums2000@gmail.com', 'despair', 9000, 2),
  ('marzo.nathaniel@gmail.com', 'Bojow', 5800, 4),
  ('raymondjohnsantos@gmail.com', 'Qpal', 3000, 5),
  ('amacsistina@gmail.com', 'Ylecam', 7600, 1),
  ('glennquintos01@gmail.com', 'lulupapa', 3600, 5),
  ('mlbbbuen79@gmail.com', 'Toki the faithful', 8500, 1),
  ('stephenpaulguibao@gmail.com', 'Kyu', 5000, NULL),
  ('nekopiarenz@gmail.com', 'Flux', 5700, NULL),
  ('micahelmarata@gmail.com', 'kelly_', 4820, 2),
  ('jhonlloydatil@gmail.com', 'Zxc-yoursisaa', 6500, 1),
  ('guindanaoclaire@gmail.com', 'Kleyr', 7800, 2),
  ('franzlee27@gmail.com', 'Miori', 2817, 1),
  ('markociprohuaqin123@gmail.com', 'lef', 5500, 4),
  ('capenajesthan@gmail.com', 'caps', 7500, 4),
  ('charlottelin0909@gmail.com', 'Milli', 7000, 1),
  ('gelostamaria668@gmail.com', 'Kagemusha', 3700, 1),
  ('recanartagabunlang@gmail.com', 'Kael (kael1401)', 8300, 4),
  ('mongosera@gmail.com', 'bossregz', 2700, 5),
  ('lloydcortez99@gmail.com', 'Namnam', 4500, 1),
  ('madronio.im@gmail.com', 'Chrislei', 5800, NULL),
  ('gallardoraymarruiz@gmail.com', 'Nyorkieess', 5000, 4),
  ('johnaristonf@gmail.com', '@@', 5700, 1),
  ('trixiearseno@gmail.com', 'Boyet', 5700, 3),
  ('chsncbllr@gmail.com', 'Chsn', 8300, 4),
  ('paulalexismirasol@gmail.com', '=)', 7800, 3),
  ('shanlier7@gmail.com', 'cyannn_', 10600, 1),
  ('williamsongco8@gmail.com', 'Astig', 8500, 2),
  ('oro.larry2@gmail.com', 'Roshan', 4000, 4),
  ('c18-0559-903@uphsl.edu.ph', 'santino', 10000, 2),
  ('naoki0207venus@gmail.com', 'NAOKING', 2800, NULL),
  ('exoul05@gmail.com', 'Audits', 6200, NULL),
  ('jakemendez1322@gmail.com', 'Unhoely', 5200, 5),
  ('mobiledodong@gmail.com', 'James', 7000, 2),
  ('decastrojunnie@gmail.com', 'Tteokbokki', 6500, 2),
  ('seninaroel@gmail.com', 'Pinkman', 6000, 2),
  ('atienzanralph35@gmail.com', '_baeconn25', 4500, NULL),
  ('tolentinorodney53@gmail.com', 'jari', 6000, 1),
  ('asayasjohn8@gmail.com', 'Duckyndall', 5000, 1),
  ('angelomaridreyes0307@gmail.com', 'Krayn', 5000, 3),
  ('kirtjasonantoni@gmail.com', 'Kirt', 5240, 1),
  ('christianhemmings69@gmail.com', 'kshtnis', 8000, 2),
  ('clintolaco27@gmail.com', 'Hansolo', 4200, 1),
  ('vitsogood@gmail.com', 'Jy', 6000, 4),
  ('mjdc0x3a@gmail.com', 'Jeremy', 6000, 3),
  ('markdavidparanis@gmail.com', 'aceyrino', 3500, 5),
  ('13n.only@gmail.com', 'fice', 5050, 1),
  ('eysanandres@gmail.com', 'asap.ey', 4500, 1),
  ('ambs@gmail.com', 'Ambss', 2000, 5),
  ('juliusmaquinto@gmail.com', 'TOINKS', 5000, 4),
  ('justine.quimque@gmail.com', 'Vii', 4660, 4),
  ('pingoljerichoroy@gmail.com', 'aquila', 7500, 1),
  ('wizaoa2268@gmail.com', 'TAONG GUBS', 3800, 5),
  ('mtvicera.sbcm@gmail.com', 'Mimasaur', 4000, 5),
  ('mikkomiggoumali@gmail.com', 'mikks', 5000, 2),
  ('aldrinedquila11@gmail.com', 'Julia mae', 3000, 5),
  ('kielmark18@gmail.com', 'Kiela Gee', 4700, 5),
  ('colderiayves@gmail.com', 'pamela', 10900, 5),
  ('dreirodriguez0824@gmail.com', 'kokoo', 2500, 5),
  ('weakedjelp@gmail.com', 'Tres', 6500, 5),
  ('mraakzkraamz@gmail.com', 'mrakkramz', 6100, 5),
  ('royaltydream26@gmail.com', 'Somnium', 5300, 1),
  ('reginmontilla2@gmail.com', 'Iceeey', 4000, 5),
  ('dantes.yence07@gmail.com', 'Yence', 6070, NULL),
  ('laoverboy17@gmail.com', 'Lao', 7000, 5),
  ('jamespoblete3221@gmail.com', 'MJ', 10000, 2),
  ('kcoper95@gmail.com', 'Kit', 4000, 5),
  ('jalfred.panganiban29@gmail.com', 'Sekisaki', 1500, 5),
  ('giancarlovdecastro@gmail.com', 'Cannabeast', 6500, NULL),
  ('markeliang171@gmail.com', 'slar', 7000, 1),
  ('arkeyares@gmail.com', 'kailarei', 3000, 3),
  ('hawktwah1145@gmail.com', 'penpen', 3000, 3),
  ('rojeboyalfredong@gmail.com', 'RK', 5000, 2),
  ('ceraunophile024@gmail.com', 'jinzo', 8000, 4),
  ('falconmarkalvin@gmail.com', 'Shindee', 5700, 5),
  ('pdelacruz112798@gmail.com', 'Pol', 6000, 4),
  ('aveljrpanilagan@gmail.com', 'ta0joskie', 8600, 2),
  ('aikkaii00123@gmail.com', 'K', 5000, 5),
  ('kayemendez321@gmail.com', 'kayiie', 3000, 4),
  ('doctormikehehehe@gmail.com', 'Ayss', 8900, 2),
  ('ronpotchi2627@gmail.com', 'Gar', 7000, 2),
  ('edisonexala@gmail.com', 'gl', 10800, 2),
  ('lelouch0813@gmail.com', 'theone_ofall', 9200, 2),
  ('broodma8@gmail.com', '4Live', 6500, 3),
  ('chris.burbano1995@gmail.com', '(^_^)', 3800, NULL),
  ('engrjonathann@gmail.com', 'jonathann', 6000, 2),
  ('raffyyyjapsaydelacruz22@gmail.com', 'raprapteezy', 6500, NULL),
  ('macyarmario@gmail.com', 'macydazed', 3000, 5),
  ('deividviray98@gmail.com', '_patatas1310', 4800, 5),
  ('agbayanizett01@gmail.com', 'Ego', 6800, 5),
  ('whatdoyoumeanwhatdoyoumean97@gmail.com', 'sh2', 11800, 2),
  ('sean.abasolo2003@gmail.com', 'sean', 6500, NULL),
  ('omatyaj@gmail.com', 'tams', 6000, 4);

-- 1. Apply IGN / MMR / position for players in the roster.
UPDATE players p
SET peak_mmr = r.mmr,
    ign      = r.ign,
    position = r.position,
    updated_at = now()
FROM roster r
WHERE p.email = r.email;

-- 2. Re-seed starting_lr from the corrected MMR, then rebuild the cached lr
--    from the UNTOUCHED event history.
UPDATE players p
SET starting_lr = CASE
      WHEN p.peak_mmr >= 10000 THEN 5300
      WHEN p.peak_mmr >=  8000 THEN 4600
      WHEN p.peak_mmr >=  7000 THEN 3950
      WHEN p.peak_mmr >=  6000 THEN 3350
      WHEN p.peak_mmr >=  5000 THEN 2800
      WHEN p.peak_mmr >=  4000 THEN 2300
      WHEN p.peak_mmr >=  3000 THEN 1850
      WHEN p.peak_mmr >=  2000 THEN 1450
      WHEN p.peak_mmr >=  1000 THEN 1100
      ELSE 800
    END
FROM roster r
WHERE p.email = r.email;

UPDATE players p
SET lr = p.starting_lr
       + COALESCE((SELECT SUM(delta) FROM lr_events e WHERE e.email = p.email), 0),
    updated_at = now()
FROM roster r
WHERE p.email = r.email;

-- 3. VERIFY — earned LR must still equal the sum of each player's events.
--    EXPECT 0 ROWS. If anything returns, run ROLLBACK; instead of COMMIT;
SELECT p.email, p.lr - p.starting_lr AS earned_now,
       COALESCE((SELECT SUM(delta) FROM lr_events e WHERE e.email = p.email), 0) AS earned_from_events
FROM players p
WHERE (p.lr - p.starting_lr)
      IS DISTINCT FROM COALESCE((SELECT SUM(delta) FROM lr_events e WHERE e.email = p.email), 0);

-- 4. REPORT — what changed.
SELECT b.ign, b.peak_mmr AS mmr_before, p.peak_mmr AS mmr_after,
       b.starting_lr AS seed_before, p.starting_lr AS seed_after,
       b.lr AS lr_before, p.lr AS lr_after
FROM players p
JOIN players_backup_mmr b ON b.email = p.email
WHERE b.peak_mmr IS DISTINCT FROM p.peak_mmr
ORDER BY (b.peak_mmr - p.peak_mmr) DESC;

COMMIT;

-- Rollback (before dropping the backup):
--   UPDATE players p SET peak_mmr=b.peak_mmr, ign=b.ign, position=b.position,
--                        starting_lr=b.starting_lr, lr=b.lr
--   FROM players_backup_mmr b WHERE p.email=b.email;
