import europe from './story-europe-countries.json' with {type:'json'};
// Story projections record the Europe set they were built with. Projections from before
// version 14 used the earlier set, which lacked Russia and the point-drawn territories.
const ADDED_IN_V14=new Set(['RUS','BHR','FRO','ALA','GGY','GIB','JEY','IMN']);
export const europeBeforeV14=Object.freeze(europe.ids.filter(id=>!ADDED_IN_V14.has(id)));
export const publishedEurope=state=>Array.isArray(state?.europe)?state.europe:europeBeforeV14;
