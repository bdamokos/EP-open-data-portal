// Adapt retained multi-year fixtures to the API's year filter.
export const yearCatalogue=request=>async(endpoint,params={},...args)=>{
  const record=await request(endpoint,params,...args);
  if(endpoint!=='/meetings'||!Array.isArray(record?.payload?.data))return record;
  return {...record,payload:{...record.payload,data:record.payload.data.filter(node=>!node?.activity_date||Number(node.activity_date.slice(0,4))===Number(params.year))}};
};
