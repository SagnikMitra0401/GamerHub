# Eval cases

Run these in check mode after any change to the skill. Compare the findings with the expected list, not with a feeling about the text. Case 12 has to come back clean.

`node scripts/unslop-eval.js` reads this file. The `Expected` ids name the rule that has to fire on the `Sample`, and every `Fixed` line has to come back with no findings at all. A repaired text that still trips a rule is a failed fix, and so is a clean text that trips one.

## Case 1: German opener with a formula

**Sample:** „In der heutigen digitalen Welt ist es nicht nur wichtig, sondern entscheidend, dass Vereine ihre Termine online verwalten.“
**Expected:** `formula-opener`, `negative-parallelism`, `empty-intensifier`. P1 wide-angle opener, P1 contrast pair, P2 two empty intensifiers in one sentence.
**Fixed:** „Vereine verwalten ihre Termine online.“
**Change:** Opener and contrast pair removed. „entscheidend“ was dropped because the source gives no criterion for it, and no measured benefit exists to put in its place. The missing figure goes to the audit, not into the text.

## Case 2: Triad with a hedge stack

**Sample:** „Das neue Formular könnte unter Umständen schneller, übersichtlicher und benutzerfreundlicher sein.“
**Expected:** `hedge-stack`, `triad`. P1 double hedge, P1 adjective triad, P2 no measured comparison.
**Fixed:** „Das neue Formular könnte schneller und übersichtlicher sein als das alte.“
**Change:** One hedge stays because the source states a possibility, not a result. The triad is cut to two properties; „benutzerfreundlicher“ went because it names no criterion of its own. The missing measurement stays a gap.

## Case 3: English vocabulary cluster

**Sample:** „Our seamless platform helps teams leverage robust workflows to streamline their day-to-day operations.“
**Expected:** `word-list-cluster`. P1 four word-list hits in one sentence.
**Fixed:** „Our platform runs team workflows.“
**Change:** The four inflated verbs are gone, and the claim now says what the product does. Which workflows, for which teams, is not in the source, so the audit reports it.

## Case 4: Parataxis chain

**Sample:** „Der Motor startet. Die Lampe leuchtet. Der Prüfstand läuft. Nach zwei Minuten ist der Test vorbei.“
**Expected:** `parataxis-chain`. P1 chain of short main clauses.
**Fixed:** „Der Motor startet, die Lampe leuchtet und der Prüfstand läuft; nach zwei Minuten ist der Test vorbei.“
**Change:** The clauses are joined, so the sequence reads as one run-up to the result. Every clause survives; no fact was added.

## Case 5: Load-bearing metaphor as verdict

**Sample:** „Die neue Satzung trägt den Verein durch die nächsten fünf Jahre.“
**Expected:** `load-bearing-metaphor`. P1 metaphor standing in for a criterion.
**Fixed:** „Die neue Satzung gilt fünf Jahre.“
**Change:** „trägt … durch“ is replaced by the plain verb the sentence wanted. What the metaphor was supposed to measure is not in the source, so the audit records the gap instead of inventing a test.

## Case 6: Colon reveal and faux insight

**Sample:** „Der Punkt, an dem die Umstellung kippt: was die meisten übersehen.“
**Expected:** `colon-reveal`, `faux-insight`. P1 staged colon, P1 flattering setup, P2 the reveal carries no claim.
**Fixed:** „Die Umstellung hat einen Punkt, an dem sie kippt.“
**Change:** Plain sentence, setup removed. The sample names no mechanism, so the fixed version cannot name one either; the gap is reported.

## Case 7: Aphoristic kicker

**Sample:** „Die Halle ist fertig, das Dach dicht, die Heizung läuft. Am Ende zählt nicht das Gebäude, sondern der Geist darin.“
**Expected:** `aphoristic-kicker`, `negative-parallelism`. P1 maxim in the last line, P1 contrast pair inside it.
**Fixed:** „Die Halle ist fertig, das Dach ist dicht, die Heizung läuft.“
**Change:** The kicker is deleted. The contrast pair inside it goes with it. The three facts stay, and so does the short closing sentence.

## Case 8: Phantom objection

**Sample:** „Damit will ich nicht sagen, dass die alte Anlage schlecht war. Versteh mich nicht falsch: Sie hat zehn Jahre gehalten.“
**Expected:** `phantom-objection`. P1 two defensive lines against a claim nobody made.
**Fixed:** „Die alte Anlage hat zehn Jahre gehalten.“
**Change:** Both defences are cut; the fact in the second sentence carries the paragraph on its own.

## Case 9: Slide face

**Sample:** „Kennzahlen immer checken!—Tempo statt Gründlichkeit“ and „hier kurz erklären, warum das Team das so sieht“
**Expected:** `moderator-note`, `command-tone`, `negative-parallelism`, `em-dash-on-slide`. P0 footer note on the slide face, P1 barked instruction, P1 contrast pair, P1 em dash on a slide.
**Fixed:** „Empfehlung: Kennzahlen vor jedem Versand prüfen“
**Change:** Command tone becomes a recommendation. The contrast pair carried no information and is gone; the footer moves to the speaker notes, where it belongs.

## Case 10: Narrative coda

**Sample:** „Um 6:12 Uhr fiel der Strom aus. Zwei Stunden später lief die Kühlung wieder. Und da wurde mir klar, dass es nie um die Kühlung ging.“
**Expected:** `realization-coda`. P1 theme explained after the story already ended.
**Fixed:** „Um 6:12 Uhr fiel der Strom aus. Zwei Stunden später lief die Kühlung wieder.“
**Change:** The story ends on its last event. The insight line is cut, not reworded, so the reader keeps the interpretation.

## Case 11: Reply that rebuilds context

**Sample:** „Danke für deine Nachricht. Wie besprochen hatten wir das Problem mit der Zulieferung, dann die Prüfung der Chargen und schließlich die Freigabe. Nach Rücksprache mit der Qualitätssicherung und Prüfung der Unterlagen kommen wir zu dem Ergebnis, dass wir die Charge austauschen.“
**Expected:** `reply-rebuilds-context`. P1 decision buried in the last sentence behind the retraced history.
**Fixed:** „Danke für deine Nachricht. Wir tauschen die Charge aus. Die Freigabe kam nach Prüfung der Unterlagen durch die Qualitätssicherung.“
**Change:** Decision first, greeting kept. The retraced sequence moves to the ticket; the one fact that changes whether the reader agrees stays in the reply.

## Case 12: Clean text, no findings

**Sample:** „Zwei der vier Mechaniker wechseln in die Filiale an der Brienner Straße, einer geht in Rente. Die Werkstatt in der Rosenheimer Straße schließt am 31. Dezember, weil der Mietvertrag mit der Gemeinde ausläuft und die Halle im Frühjahr 2027 abgerissen wird. Offene Aufträge nimmt das Team noch bis zum 15. Dezember an. Das Team hat alle Kunden in der ersten Januarwoche angeschrieben.“
**Expected:** none. This case has to stay clean.
Severity note: sentence lengths run 16, 25, 11 and 10 words, so the rhythm ranges from 10 to 25. The facts carry the paragraph, the cause sits in a subordinate clause, and there is no metaphor, triad, hedge or formula. A reviewer who reports anything here is overflagging.
