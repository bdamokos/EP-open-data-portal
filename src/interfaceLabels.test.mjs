import {test} from 'node:test';
import assert from 'node:assert/strict';
import {interfaceLabel,countryName,languageName} from './interfaceLabels.mjs';
test('public ISO and EU country codes share localized names and missing metadata stays readable',()=>{
 assert.equal(countryName('hu','EL'),'Görögország');assert.equal(countryName('hu','EL'),countryName('hu','GR'));
 for(const value of [null,undefined,''])assert.equal(countryName('en',value),'Unknown country');
 assert.equal(countryName('en','unknown'),'unknown');
});
// These expectations are fixed independently of the runtime dictionary and Intl.
const expectedLabels={
 bg:['български','Държава','Политическа група','Изчистване на филтрите','Председател','Заместник-председател','Член','Заместник'],
 cs:['čeština','Země','Politická skupina','Vymazat filtry','Předseda','Místopředseda','Člen','Náhradník'],
 da:['dansk','Land','Politisk gruppe','Nulstil filtre','Formand','Næstformand','Medlem','Stedfortræder'],
 de:['Deutsch','Land','Fraktion','Filter zurücksetzen','Vorsitz','Stellvertretender Vorsitz','Mitglied','Stellvertretung'],
 el:['Ελληνικά','Χώρα','Πολιτική ομάδα','Επαναφορά φίλτρων','Προεδρία','Αντιπροεδρία','Μέλος','Αναπληρωτής'],
 en:['English','Country','Political group','Reset filters','Chair','Vice-Chair','Member','Substitute'],
 es:['español','País','Grupo político','Restablecer filtros','Presidencia','Vicepresidencia','Miembro','Suplente'],
 et:['eesti','Riik','Fraktsioon','Lähtesta filtrid','Esimees','Aseesimees','Liige','Asendusliige'],
 fi:['suomi','Maa','Poliittinen ryhmä','Tyhjennä suodattimet','Puheenjohtaja','Varapuheenjohtaja','Jäsen','Varajäsen'],
 fr:['français','Pays','Groupe politique','Réinitialiser les filtres','Présidence','Vice-présidence','Membre','Suppléance'],
 ga:['Gaeilge','Tír','Grúpa polaitiúil','Athshocraigh na scagairí','Cathaoirleach','Leas-Chathaoirleach','Comhalta','Ionadaí'],
 hr:['hrvatski','Država','Klub zastupnika','Poništi filtre','Predsjedništvo','Potpredsjedništvo','Član','Zamjenik'],
 hu:['magyar','Ország','Képviselőcsoport','Szűrők törlése','Elnök','Alelnök','Tag','Póttag'],
 it:['italiano','Paese','Gruppo politico','Reimposta filtri','Presidenza','Vicepresidenza','Membro','Supplente'],
 lt:['lietuvių','Šalis','Frakcija','Išvalyti filtrus','Pirmininkas','Pirmininko pavaduotojas','Narys','Pavaduojantis narys'],
 lv:['latviešu','Valsts','Politiskā grupa','Atiestatīt filtrus','Priekšsēdētājs','Priekšsēdētāja vietnieks','Loceklis','Aizstājējs'],
 mt:['Malti','Pajjiż','Grupp politiku','Irrisettja l-filtri','Presidenza','Viċi-Presidenza','Membru','Sostitut'],
 nl:['Nederlands','Land','Fractie','Filters wissen','Voorzitter','Ondervoorzitter','Lid','Plaatsvervanger'],
 pl:['polski','Państwo','Grupa polityczna','Wyczyść filtry','Przewodnictwo','Wiceprzewodnictwo','Członek','Zastępca'],
 pt:['português','País','Grupo político','Repor filtros','Presidência','Vice-presidência','Membro','Suplente'],
 ro:['română','Țară','Grup politic','Resetează filtrele','Președinție','Vicepreședinție','Membru','Membru supleant'],
 sk:['slovenčina','Krajina','Politická skupina','Zrušiť filtre','Predseda','Podpredseda','Člen','Náhradník'],
 sl:['slovenščina','Država','Politična skupina','Ponastavi filtre','Predsedstvo','Podpredsedstvo','Član','Namestnik'],
 sv:['svenska','Land','Politisk grupp','Återställ filter','Ordförande','Vice ordförande','Ledamot','Suppleant'],
};
test('all 24 interfaces have exact app-owned labels and native language names without a data export',()=>{
 const keys=['country','political_group','reset_filters','chair','viceChair','member','substitute'];
 assert.equal(Object.keys(expectedLabels).length,24);
 for(const [lang,[endonym,...labels]] of Object.entries(expectedLabels)){
  for(const [index,key] of keys.entries())assert.equal(interfaceLabel(lang,key,'missing'),labels[index],lang+':'+key);
  assert.equal(languageName(lang),endonym,lang+':endonym');
 }
});
test('unsupported interfaces use English labels and unknown keys retain the caller fallback',()=>{
 assert.equal(interfaceLabel('zz','chair','missing'),'Chair');
 assert.equal(interfaceLabel(undefined,'country','missing'),'Country');
 for(const lang of ['en','hu','zz'])assert.equal(interfaceLabel(lang,'unknown_key','Caller fallback'),'Caller fallback');
});
