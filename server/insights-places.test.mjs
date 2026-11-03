import test from 'node:test';
import assert from 'node:assert/strict';
import {titlePlaces} from './insights-places.mjs';

const ids=title=>titlePlaces(title).places.map(p=>p.id).sort();

test('an office-holder named after a country is a person, not a place',()=>{
 assert.deepEqual(ids('This is Europe - Debate with the Prime Minister of Portugal, Luís Montenegro'),['PRT']);
 assert.deepEqual(ids('This is Europe - Debate with the Prime Minister of Portugal, Luís Montenegro (debate)'),['PRT']);
});

test('the country itself and other office-holder titles keep their places',()=>{
 assert.deepEqual(ids('2023 and 2024 reports on Montenegro (debate)'),['MNE']);
 assert.deepEqual(ids('Address by Jakov Milatović, President of Montenegro'),['MNE']);
 assert.deepEqual(ids('This is Europe - Debate with the Prime Minister of Luxembourg, Luc Frieden'),['LUX']);
 assert.deepEqual(ids('King Abdullah II, King of the Hashemite Kingdom of Jordan'),['JOR']);
 assert.deepEqual(ids('UN Climate Change Conference 2024 in Baku, Azerbaijan (COP29)'),['AZE']);
 assert.deepEqual(ids('Strengthening Moldova’s resilience against Russian hybrid threats'),['MDA']);
});
