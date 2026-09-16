# Demo — Economie-assistent (3 minuten)

Status: opnameplan en spreektekst. Er is nog geen definitieve video opgenomen of geëxporteerd. Neem de schermbeelden met echte bronnen en werkende Part 1-endpoints op; toon geen voorbeeldantwoorden als echte modeluitvoer. De architectuurslide staat in `docs/architecture.svg` (16:9, 1920 × 1080).

## Voorbereiding

- Start de app zonder `NEXT_PUBLIC_USE_FIXTURES`; seed de negen documenten. Gebruik voor de uploadscène een afzonderlijke demo-database met de historische FAVV-gids aanvankelijk overgeslagen, zoals in PLAN.md §14.
- Controleer Q1 en Q8, de PDF-pagina's, het wijzigen van bronnen, opslaan van beoordelingen, Instellingen en de briefing. Houd een eerder goedgekeurd antwoord beschikbaar.
- Neem 1080p op met 110% browserzoom; sluit andere tabbladen en meldingen. Toon bij Instellingen uitsluitend gemaskeerde sleutels. Typ sleutels buiten de opname in.
- Neem onderstaande scènes als losse clips op zodra ze echt werken. Gebruik de meest recente goede opname. De extra's (zoeken, context, samenvattingen, spraak, bronselectie, Logboek, streaming) kunnen in de live demo worden getoond; de film volgt de drie jurycriteria.

## Montage en spreektekst

| Tijd | Schermhandeling | Spreektekst |
|---|---|---|
| 00:00–00:25 | Titel: **Economie-assistent — Challenge 2: Answer Like the Expert**. Nieuwe vraag, gemeente en actieve bronnen zichtbaar. | “Een ondernemer vraagt hoe hij een vaste plaats op de markt aanvraagt. Een medewerker zoekt het antwoord in reglementen, handleidingen en oude mails. Onze Economie-assistent brengt de vraag en de bijbehorende bronpassages samen. De medewerker houdt de controle: de app stelt een antwoord voor, maar verzendt nooit iets.” |
| 00:25–00:50 | Plak Q1. Toon het groeiende antwoord en daarna het gevalideerde resultaat. Klik op een verwijzing naar artikel 13 §3. | “We stellen de vraag in het Nederlands. De assistent doorzoekt uitsluitend de ingeschakelde bronnen. Elke verwijzing opent een opgeslagen passage, met de documentversie, het artikel en de pagina. Hier staat het aanvraagformulier op de gemeentelijke website. Het antwoord kan dus direct worden nagekeken.” |
| 00:50–01:15 | Open PDF op pagina 5, ga terug. Toon ontbrekende informatie, vink twee passages aan, pas één zin aan, keur goed en kopieer. | “Eén klik opent de PDF op de juiste pagina. Ontbrekende informatie en onzekerheid over de toepasselijkheid blijven zichtbaar. De medewerker controleert de passages, past de formulering aan en keurt de tekst goed. Kopiëren neemt de bronvermelding mee. Een latere wijziging zet een goedgekeurd antwoord weer terug naar concept.” |
| 01:15–01:45 | Bronnen: upload de historische FAVV-gids. Stel Q8. Toon historische status en conflict, schakel de gids uit. Open het eerdere antwoord in Geschiedenis en wijs de wijzigingsbanner aan. | “De bronnenbibliotheek wordt door de medewerker onderhouden. Een oudere FAVV-gids krijgt expliciet de status Historisch. Bij de vraag over Foodweb is het verschil met de brochure van 2026 zichtbaar. Als we de oude bron uitschakelen, gebruikt een nieuw antwoord die niet meer. Het eerdere antwoord behoudt zijn bewijs en biedt opnieuw genereren met de huidige bronnen aan.” |
| 01:45–02:05 | Architectuurslide `architecture.svg`. | “De app draait op Next.js en SQLite. PDF-tekst wordt per pagina opgeslagen en doorzoekbaar gemaakt. De server selecteert bronpassages, vraagt een antwoord aan het gekozen taalmodel en controleert de verwijzingen. Antwoorden, beoordelingen en bronwijzigingen blijven traceerbaar.” |
| 02:05–02:25 | Instellingen: model per taak, gemaskeerde sleutels, een geslaagde modeltest. Toon kort Logboek. | “De modelaanbieder is een instelling. Voor het antwoord, een e-mailconcept en samenvattingen kan de medewerker verschillende modellen kiezen. Sleutels blijven op de server. Het Logboek verbindt wijzigingen met de betreffende vraag of bron. Een andere gemeente kan dezelfde werkwijze gebruiken met haar eigen documenten en instellingen.” |
| 02:25–03:00 | Briefing afdrukken, printvoorbeeld met bewijs en beoordeling. Terug naar antwoord, eindkaart. | “De briefing bundelt vraag, bevinding, bewijs, toepasselijkheid, onzekerheden en de beoordeling. Zij kan worden afgedrukt of als PDF opgeslagen. Dit prototype ondersteunt tekst-PDF's; het beoordeelt niet zelfstandig of een regel juridisch geldig is. Die afweging blijft bij de medewerker. Onze bijdrage is een controleerbaar antwoord, een beheersbare bronnenbibliotheek en een zichtbaar spoor van iedere beoordeling.” |

## Exacte vragen

Q1: “Ik wil een vaste standplaats op de markt in Schoten. Hoe dien ik een aanvraag in?”

Q8: “Moet ik mij via Foodweb registreren bij het FAVV voor mijn voedselkraam?”

## Export en indiening

1. Zet de clips in bovenstaande volgorde, trim wachttijd zonder te suggereren dat een model sneller antwoordt dan het werkelijk doet, en spreek de tekst in. Houd de totale duur op maximaal 3:00.
2. Exporteer 1920 × 1080, H.264/MP4 met verstaanbare audio. Bekijk de export volledig, inclusief bronverwijzingen, historische waarschuwing en printvoorbeeld.
3. Upload naar het YouTube-account van het team als verborgen of openbaar. Controleer afspelen in een privévenster. Dien de werkende link in via het formulier van de organisatoren.
4. Zet voor een publieke demo eerst het wachtwoord en sessiegeheim op de server en controleer de Part 1-loginbeveiliging/rate limit. Deel alleen daarna de tunnel-URL en het werkruimtewachtwoord op de tafelkaart.

Openstaande externe stappen: echte clips, ingesproken audio, montage/export, YouTube-upload en formulierinzending. Deze repository bevat geen opnamebestanden of accounttoegang; voltooi deze stappen met het team zodra de volledige backend is geïntegreerd.
