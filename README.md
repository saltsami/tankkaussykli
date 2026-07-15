# TankkausSykli

Mobiiliystävällinen Next.js-websovellus, jolla kuluttaja voi vertailla lähialueen polttoainehintoja, tarkastella asemakohtaista hintatrendiä ja ilmoittaa pumpulla näkemänsä hinnan.

Sovellus toimii ilman ympäristömuuttujia esittelytilassa. Kun Supabase on yhdistetty, se hakee OpenStreetMap-asemat käyttäjän valitseman kotipaikan ympäriltä ja näyttää yhteisön tallentamat hinnat.

## MVP:n ominaisuudet

- kotipaikan valinta haulla tai selaimen paikannuksella
- kotipaikan paikallinen tallennus selaimeen
- 95E10-, 98E5- ja diesel-suodatus
- kartta, etäisyydet ja hinnan mukaan järjestetty asemalista
- valitun aseman oikeista hintahavainnoista muodostettu 8 viikon historia
- kolmen päivän viikonpäiväarvio, kun toteutuneita hintapäiviä on vähintään 14
- asemakohtainen halpa-, normaali- tai odota-signaali
- laitekohtainen hintavahti ja järjestelmäilmoitus, kun oma hintaraja alittuu
- anonyymi yhteisöhinnan ilmoittaminen Supabaseen
- Row Level Security -säännöt ja rajattu hintojen lukufunktio
- responsiivinen PWA-manifesti ja Vercel-valmis tuotantobuild
- GitHub Actions -tarkistukset: lint, TypeScript ja build

## Teknologia

- Next.js 16 / React 19 / TypeScript
- Leaflet ja OpenStreetMap-karttalaatat
- OpenStreetMap Overpass asemien löytämiseen
- Nominatim vain käyttäjän lähettämiin paikkahakuihin
- Supabase Auth + Postgres + RLS hintahavainnoille

Kotipaikkaa ei tallenneta Supabaseen. Se säilyy selaimen `localStorage`-muistissa. Koordinaatteja käytetään vain lähiasemien ja hintojen hakemiseen.

Myös hintavahtien rajat säilyvät tässä MVP:ssä vain käyttäjän laitteella. Sovellus tarkistaa ne avattaessa ja käytön aikana. Täysin taustalla toimiva Web Push edellyttää myöhemmässä vaiheessa VAPID-avaimia ja palvelinpuolista hintahavaintojen käynnistämää push-lähetystä.

## Paikallinen käynnistys

Vaatimus: Node.js 24.

```bash
npm install
copy .env.example .env.local
npm run dev
```

Avaa [http://localhost:3000](http://localhost:3000). Ilman Supabase-arvoja sovellus näyttää selkeästi merkityt esimerkkihinnat.

## Supabase

1. Luo uusi Supabase-projekti.
2. Avaa projektin SQL Editor.
3. Suorita `supabase/migrations`-kansion SQL-tiedostot numerojärjestyksessä. Supabase CLI:tä käytettäessä komento on `supabase db push`.
4. Ota käyttöön **Authentication → Providers → Anonymous Sign-Ins**.
5. Lisää projektin URL ja publishable key `.env.local`-tiedostoon:

```env
NEXT_PUBLIC_SUPABASE_URL=https://PROJECT.supabase.co
NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY=sb_publishable_...
```

Anonyymit käyttäjät saavat lisätä oman hintahavaintonsa, mutta eivät lukea muiden käyttäjätunnisteita. Julkinen RPC palauttaa vain aseman OSM-tunnisteen, uusimman hinnan, aikaleiman ja havaintomäärän.

Ennen julkista markkinointia ota Supabasen Anonymous Sign-Ins -asetuksissa käyttöön Cloudflare Turnstile tai hCaptcha väärinkäytön rajoittamiseksi. Lisää myöhemmin myös havaintojen poikkeama- ja nopeusrajat palvelinpuolelle.

## Kartta- ja paikkapalvelut

Oletusasetukset käyttävät OpenStreetMapin julkisia Nominatim-, Overpass- ja rasterilaattapalveluita maltilliseen prototyyppikäyttöön. Sovellus:

- tekee paikkahaun vain lomakkeen lähetyksestä, ei automaattista täydennystä
- välimuistittaa paikkahaut ja asemakyselyt Next.js:n kautta
- näyttää OpenStreetMap-attribuution kartalla
- sallii kaikkien palveluosoitteiden vaihtamisen ympäristömuuttujilla
- putoaa esittelytilaan, jos asemadata ei vastaa

Kasvavan tuotantoliikenteen kanssa käytä sopimukseen perustuvaa geokoodaus-, asemadata- ja karttalaattapalvelua. Älä tee offline-laattojen esilatausta julkisesta OSM-palvelusta.

## Laadunvarmistus

```bash
npm run lint
npm run typecheck
npm run build
```

## Julkaisu GitHubiin ja Verceliin

Kun kansio on GitHub-repossa:

1. Luo GitHubissa tyhjä repo ja lisää se remoteksi: `git remote add origin <repo-url>`.
2. Puske nykyinen haara: `git push -u origin codex/tankkaussykli-app`.
3. Valitse Vercelissä **Add New → Project** ja tuo GitHub-repo.
4. Lisää Vercelin Project Settings → Environment Variables -kohtaan Supabase-muuttujat.
5. Julkaise. Vercel tunnistaa Next.js-sovelluksen automaattisesti.

Server-only muuttujat `OVERPASS_API_URL`, `NOMINATIM_API_URL` ja `NOMINATIM_EMAIL` ovat valinnaisia. Jos ne jätetään pois, käytetään `.env.example`-tiedoston oletuksia.

## Seuraavat tuotantovaiheet

- pidemmän aikavälin ennustemalli nykyisen läpinäkyvän viikonpäivämediaanin tilalle
- taustalla toimivat Web Push -tilaukset Supabase Edge Functionin tai muun push-workerin kautta
- väärien havaintojen poikkeamasuodatus ja käyttäjäkohtainen nopeusrajoitus
- kumppanuus jatkuvaan kaupalliseen asemakohtaiseen hintadataan
- reitin varrella olevien asemien vertailu
