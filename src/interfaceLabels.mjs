import {defaultUi} from './uiDefault.mjs';
const keys = ['country','political_group','reset_filters','chair','viceChair','member','substitute'];
const labels = {
 en:['Country','Political group','Clear filters','Chair','Vice-Chair','Member','Substitute'],
 bg:['Държава','Политическа група','Изчистване на филтрите','Председател','Заместник-председател','Член','Заместник'],
 cs:['Země','Politická skupina','Zrušit filtry','Předseda','Místopředseda','Člen','Náhradník'],
 da:['Land','Politisk gruppe','Ryd filtre','Formand','Næstformand','Medlem','Stedfortræder'],
 de:['Land','Fraktion','Filter zurücksetzen','Vorsitz','Stellvertretender Vorsitz','Mitglied','Stellvertretung'],
 el:['Χώρα','Πολιτική ομάδα','Απαλοιφή φίλτρων','Προεδρία','Αντιπροεδρία','Μέλος','Αναπληρωτής'],
 es:['País','Grupo político','Borrar filtros','Presidencia','Vicepresidencia','Miembro','Suplente'],
 et:['Riik','Fraktsioon','Eemalda filtrid','Esimees','Aseesimees','Liige','Asendusliige'],
 fi:['Maa','Poliittinen ryhmä','Tyhjennä suodattimet','Puheenjohtaja','Varapuheenjohtaja','Jäsen','Varajäsen'],
 fr:['Pays','Groupe politique','Effacer les filtres','Présidence','Vice-présidence','Membre','Suppléance'],
 ga:['Tír','Grúpa polaitiúil','Glan scagairí','Cathaoirleach','Leas-Chathaoirleach','Comhalta','Ionadaí'],
 hr:['Država','Klub zastupnika','Ukloni filtre','Predsjedništvo','Potpredsjedništvo','Član','Zamjenik'],
 hu:['Ország','Képviselőcsoport','Szűrők törlése','Elnök','Alelnök','Tag','Póttag'],
 it:['Paese','Gruppo politico','Rimuovi filtri','Presidenza','Vicepresidenza','Membro','Supplente'],
 lt:['Šalis','Frakcija','Pašalinti filtrus','Pirmininkas','Pirmininko pavaduotojas','Narys','Pavaduojantis narys'],
 lv:['Valsts','Politiskā grupa','Noņemt filtrus','Priekšsēdētājs','Priekšsēdētāja vietnieks','Loceklis','Aizstājējs'],
 mt:['Pajjiż','Grupp politiku','Neħħi l-filtri','Presidenza','Viċi-Presidenza','Membru','Sostitut'],
 nl:['Land','Fractie','Filters wissen','Voorzitter','Ondervoorzitter','Lid','Plaatsvervanger'],
 pl:['Państwo','Grupa polityczna','Wyczyść filtry','Przewodnictwo','Wiceprzewodnictwo','Członek','Zastępca'],
 pt:['País','Grupo político','Limpar filtros','Presidência','Vice-presidência','Membro','Suplente'],
 ro:['Țară','Grup politic','Ștergeți filtrele','Președinție','Vicepreședinție','Membru','Membru supleant'],
 sk:['Krajina','Politická skupina','Zrušiť filtre','Predseda','Podpredseda','Člen','Náhradník'],
 sl:['Država','Politična skupina','Počisti filtre','Predsedstvo','Podpredsedstvo','Član','Namestnik'],
 sv:['Land','Politisk grupp','Rensa filter','Ordförande','Vice ordförande','Ledamot','Suppleant'],
};
export function interfaceLabel(language,key,fallback) {
 const index=keys.indexOf(key);
 return index<0?fallback:(labels[language]||labels.en)[index]||fallback;
}
export function countryName(language,code, ui = defaultUi) {
 if(!/^[A-Z]{2}$/.test(code||''))return code||ui.t("interfaceLabels.unknownCountry");
 return new Intl.DisplayNames([language],{type:'region'}).of(code==='EL'?'GR':code)||code;
}
/** Compare country identifiers by the names displayed in the interface. */
export function compareCountries(language,a,b, ui = defaultUi) {
 return countryName(language,a, ui).localeCompare(countryName(language,b, ui),language);
}
export function languageName(code) {
 return ({ga:'Gaeilge',mt:'Malti'})[code]||new Intl.DisplayNames([code],{type:'language'}).of(code)||code.toUpperCase();
}
