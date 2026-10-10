# Taustalla toimiva hintavahti

## Toteutettu koodi

- Next.js API tallentaa hintarajan ja selaimen Push-tilauksen Supabaseen. API varmistaa Supabase Bearer -tunnuksen `auth.getUser`-kutsulla; käyttäjätunnusta ei hyväksytä lomakkeesta. Nykyinen anonyymi kirjautuminen säilyy. Tunnuksia ei tarvitse antaa kehittäjälle.
- Taulut ja RPC-funktiot ovat vain palvelinroolin käytössä, RLS on päällä. Käyttäjän luku- ja poistopyynnöt suodatetaan API:ssa omistajalla. Push-osoitteita ja avaimia ei palauteta käyttöliittymään tai lokiin. Tunnettujen selainpalvelujen HTTPS-osoitteiden sallintalista estää mielivaltaiset palvelinpyynnöt. Uuden Push-palvelun tuki vaatii sallintalistan päivityksen ja testin.
- Asemakohtainen raja on erillinen kullekin polttoainelajille (`95E10`, `98E5`, `DIESEL`). `2.000` hyväksytään kaikille; pikapainike täyttää rajan. Nykyinen **enintään**-semantiikka säilyy: myös tasan 2,000 €/l täyttää rajan. Valitse 1,999 €/l, jos haluat vain alle 2 €/l.
- Enintään 100 vahtia ja 10 Push-tilausta käyttäjäistuntoa kohti. Raja tallennetaan palvelimelle, kotipaikka pysyy selaimessa. OSM-asema voidaan tallentaa ilman hintahavaintoa; mitään hintaa ei keksitä.
- `GET /api/cron/price-alerts` tarkistaa viimeisimmän aidon yhteisöhavainnon, kirjaa lähetysjonon ja toimittaa enintään 20 ilmoitusta ajossa. Reitti vaatii `Authorization: Bearer <CRON_SECRET>`. Välimuistit ohitetaan.
- GitHub Actions -ajastus kutsuu tuotantoreittiä noin 15 minuutin välein. Se alkaa vasta workflow-tiedoston ollessa oletushaarassa ja salaisuuksien ollessa asetettuina. `workflow_dispatch` mahdollistaa käsiajon. Vaihtoehtona samaa reittiä voi kutsua palveluntarjoajan schedulerilla tai omalla cronilla. Käytä yhtä ajastinta.
- Service worker vastaanottaa Pushin myös sivun ollessa suljettuna, näyttää oikean havaintoajan ja avaa aseman/polttoaineen. Selaimen ja käyttöjärjestelmän Push-tuki, verkko ja asetukset vaikuttavat toimitukseen; kokonaan sammutettu laite tai estetty selain ei saa välitöntä ilmoitusta. iOS:ssa tarvitaan Pushia tukeva kotinäyttö-PWA.

## Tuoreus ja toiston esto

`observed_at` on hinnan havaintoaika. `created_at`, ajastuksen aika ja käyttöliittymän päivitys eivät muuta sitä tuoreeksi. Viimeisin havainto valitaan järjestyksessä `observed_at DESC, created_at DESC, id DESC`; vanhaa halpaa havaintoa ei käytetä uudemman kalliin hinnan tilalla. Tuleva havaintoaika ei kelpaa ennen kyseistä aikaa.

Oletusraja on **24 tuntia**. `PRICE_ALERT_MAX_AGE_HOURS` sallii 1–48 tunnin ikkunan. Lähetyshetkellä tuoreus tarkistetaan uudelleen; myös Push-palvelun TTL ja service workerin vanhenemistarkistus rajoittavat viivästynyttä toimitusta. 24 tuntia on valittu tarkistettavaksi oletukseksi, ei lupaukseksi pumpun nykyhinnasta.

Ensimmäinen tuore rajan täyttävä havainto käynnistää hälytyksen. Uusi havainto edelleen rajan alapuolella kuuluu samaan hintajaksoon. Vain tuore rajan ylittävä havainto aktivoi vahdin uudelleen. Puuttuva tai vanhentunut tieto ei aktivoi vahtia. Jos hinta kävi ylhäällä ajastuskertojen välissä mutta viimeisin on jälleen alhaalla, käyntiä ei tulkita uudeksi jaksoksi: vahti käyttää tarkistushetken uusinta tietoa.

Lisäksi onnistuneiden lähetysten välissä on 12 tunnin tauko. Uusi rajan alitus tauon aikana jonotetaan, mutta perutaan hinnan noustessa tai havainnon vanhetessa. Sama havainto ja sääntö eivät koskaan saa kahta onnistuneeksi kirjattua toimitusta. Hintarajan muutos arvioi viimeisimmän aidon havainnon uudelleen, mutta jo lähetetty havainto ei aiheuta uutta lähetystä.

Arviointi lukitaan transaktion ajaksi. Lähetykset varataan `FOR UPDATE SKIP LOCKED` -operaatiolla, kahden minuutin vuokralla ja yksilöllisellä vuokratunnuksella. Vanhalla tunnuksella ei voi merkitä uudelleen varattua työtä valmiiksi. Tilapäinen lähetysvirhe yrittää uudelleen kasvavalla viiveellä, enintään viisi yritystä. 404/410 poistaa Push-tilauksen käytöstä. Käyttäjä voi aktivoida tilauksen tallentamalla vahdin uudelleen.

Web Push ja tietokanta eivät muodosta yhtä transaktiota. Jos palvelin kaatuu onnistuneen Push-lähetyksen ja tietokantakuittauksen välissä, lähetys voi toistua. Vakaa toimitustunniste, ilmoituksen `tag` ja service workerin CacheStorage-tunniste vähentävät käyttäjälle näkyviä toistoja. Täsmälleen kerran tapahtuvaa toimitusta ei luvata. Jo verkkoon lähtenyttä ilmoitusta ei voi perua hintarajan muutoksen tai poiston yhteydessä.

## Käyttöönotto (ylläpitäjä)

1. Suorita kaikki Supabase-migraatiot järjestyksessä, mukaan lukien `202610100001_server_price_alerts.sql` (`supabase db push` tai SQL Editor). Migraatio luo tauluja/funktioita eikä muokkaa aiempia hintahavaintoja.
2. Säilytä Anonymous Sign-Ins käytössä. Ota tuotannossa käyttöön CAPTCHA ja API:n liikenteen rajoitus: anonyymien käyttäjien luominen voi muuten kiertää käyttäjäkohtaiset määrärajoitukset.
3. Luo VAPID-avaimet kerran luotetussa ympäristössä: `npx web-push generate-vapid-keys --json`. Tallenna arvot salaisuuksina, älä commitoi niitä. Avaimen vaihto vaatii selaimen tilauksen uusimisen; käyttöliittymä tekee tämän seuraavalla käyttäjän käynnistämällä tallennuksella.
4. Aseta Next.js-palvelun ympäristöön `.env.example`-tiedoston julkinen Supabase URL/publishable key sekä **palvelinpuolelle** `SUPABASE_SERVICE_ROLE_KEY`, `VAPID_PUBLIC_KEY`, `VAPID_PRIVATE_KEY`, `VAPID_SUBJECT` (oma mailto-yhteystieto), `CRON_SECRET` (esim. `openssl rand -hex 32`) ja tarvittaessa tuoreusikkuna. Julkinen VAPID-avain välitetään selaimelle asetusten API:sta, yksityinen ei koskaan.
5. Julkaise Node.js-palvelin ja HTTPS-sivusto. Staattinen export ei riitä. Ilman asetuksia demo, hintojen ilmoittaminen ja paikallinen vahti säilyvät; taustavahdin tallennus näyttää käyttöönoton puuttumisen.
6. Lisää GitHub-repositorion Actions-salaisuuksiksi `PRICE_ALERT_BASE_URL` (esim. `https://oma-tuotantodomain.fi`) ja sama `CRON_SECRET`. Workflow ei julkaise sovellusta eikä suorita migraatioita. Käsiaja ajastus ensin ja tarkista HTTP-tulos sekä Supabasen jonotaulut. Vasta tämän jälkeen ota aikataulu käyttöön yhdistämällä workflow oletushaaraan. GitHubin ajastukset voivat viivästyä ja inaktiivisen julkisen repositorion ajastus voi pysähtyä; jatkuva tuotantopalvelu kannattaa ajastaa valvotulla palveluajastimella.
7. Avaa oikea asema ja valitse polttoaine, paina 2,000 €/l ja tallenna taustavahti. Hyväksy ilmoitukset. Sulje välilehti, ilmoita toisesta käyttäjäistunnosta tuore rajan täyttävä havainto ja varmista toimitus. Älä käytä vanhaa havaintoa tai demoasemaa smoke-testissä.

Ajastus tuottaa määrälaskurit `queued`, `claimed`, `sent`, `retry`, `gone`, `obsolete`. `sent` tarkoittaa Push-palvelun hyväksymää pyyntöä, ei laitteen lukukuittausta. Tarkkaile epäonnistuneita ajoja, kasvavaa jonoa, `failed`-rivejä ja puuttuvia tuoreita havaintoja. Jonon läpäisykyky on 20/ajo; kasvavassa käytössä lisää ajotiheyttä tai erillinen worker. Säilytä vain tarpeelliset toimituslokit; esimerkiksi yli 90 päivää vanhat päättyneet rivit voidaan poistaa, mutta niiden poistaminen poistaa myös kyseisten havaintojen pysyvän deduplikoinnin. Älä automaattisesti poista aktiivisia tilauksia tai käyttäjien sääntöjä.

## Nykyisten vahtien siirtymä

`localStorage`-vahteja ei siirretä hiljaisesti. Avaa aiempi vahti, valitse taustavahti ja tallenna ilmoitusluvalla. Onnistunut palvelintallennus korvaa paikallisen säännön; palvelinvahtia ei tarkisteta uudelleen asiakaspuolella. Palvelinsäännöt haetaan sivun avauksessa nykyisen Supabase-istunnon kautta. Virhe ei tyhjennä paikallisia sääntöjä. Poisto vahvistetaan palvelimelta ennen paikallisen säännön poistoa, ja jonorivit poistuvat viiteavainten avulla.

Anonyymi käyttäjätunnus on sidottu selaimen tallennettuun Supabase-istuntoon. Jos selaindata poistetaan, vanhoja sääntöjä ei voi hallita uudesta anonyymistä istunnosta, eikä tätä kierretä omistajuuden vaihtamisella. Ennen laajaa julkaisua lisää pysyvä kirjautuminen/istunnon palautus ja tilin poistopolku. Push-tilauksen voi estää selaimen asetuksista; vanhentuneet tilaukset poistetaan lähetyskäytöstä. Aikaisemman istunnon päätepisteen omistajuusristiriita kerrotaan käyttäjälle.

Paikallinen vahti säilyttää aiemman 12 tunnin tauon, mutta ei enää ilmoita demo-, tuleva- tai yli 24 tuntia vanhasta hinnasta eikä samasta havaintoajasta uudelleen. Sen käyttöliittymä sanoo selvästi, että sovelluksen täytyy olla auki.

## Ulkoiset riippuvuudet ja rajat

Koodi ei sisällä jatkuvaa huoltoasemien hintasyötettä. Hälytys syntyy vain, jos Supabaseen tulee riittävän tuoreita käyttäjien havaintoja. Web Push, cron ja Supabase eivät takaa valtakunnallista kattavuutta. Tuore yhteisöhavainto voi myös olla virheellinen: hinnan oikeellisuus ja pumpun lopullinen hinta ovat eri asioita kuin havaintoajan tuoreus.

Kaupallinen/kumppanin API tarvitsee erikseen sovitun tietolähteen, käyttöoikeudet/tunnukset ja sovittimen. Sovittimen on tallennettava lähteen **todellinen havaintoaika** sekä lähteen oma deduplikointitunniste; hakuaikaa ei saa käyttää vanhan hinnan havaintoaikana. Nykyinen hintojen ilmoitustriggeri edellyttää käyttäjän `auth.uid()`-tunnusta eikä hyväksy sellaisenaan palvelinavaimella tehtyä lähdeimporttia. Importille on toteutettava erillinen rajattu ja auditoitu kirjoituspolku, alkuperätiedot ja poikkeamasuodatus ennen sen kytkemistä. Tätä ei ole tehty ilman sovittua datalähdettä.

## Testaus

`npm test` suorittaa olemassa olevat trenditestit, validoinnin ja toimitusworkerin testit sekä oikeat SQL-migraatiot PGliten PostgreSQL-moottorissa. Testissä luodaan Supabase-roolien/auth-skeeman minimi ja käytetään PostgreSQL:n sisäistä `gen_random_uuid`-funktiota ilman pgcrypto-asennusta. Historialliset testihavainnot ohittavat vain vanhan syötetriggerin; hintavahdin SQL suoritetaan sellaisenaan. Testit eivät korvaa stagingin Supabase/PostgREST- ja oikean selain-Pushin smoke-testiä tai aidon moniyhteyksisen PostgreSQL:n kuormitustestiä.

Lisäksi: `npm run lint`, `npm run typecheck`, `npm run build` ja buildin jälkeen `npm run test:api`. Viimeinen käynnistää tuotannon Next.js-reitit paikallista Supabase-HTTP-testipalvelua vasten ja tarkistaa istunnon, omistajuussuodattimet, palvelimen käyttämän omistajatunnuksen, syötekoon, alkuperän ja ajastusreitin. Testi ei lähetä oikeaa Pushia. Käyttöönottoa, oikeaa Push-lähetystä tai tuotantomigraatiota ei ole tehty ilman palvelun omia asetuksia.
