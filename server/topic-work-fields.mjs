// Strip distributions and transcript bodies before creating JavaScript objects.
// json_each preserves omitted fields, which differ from explicitly empty links.
const fields=['id','identifier','activity_id','activity_date','activity_label','had_activity_type','had_participation','work_type','document_date','title_dcterms','is_realized_by','recorded_in_a_realization_of','creator','workHadParticipation','is_about','isAboutSubjectMatter','inverse_created_a_realization_of','inverse_based_on_a_realization_of','inverse_decided_on_a_realization_of','based_on_a_realization_of','inverse_consists_of','inverse_was_scheduled_in','executed','consists_of','process_type','process_title','label','outside','date','titles','source','based_on','is_derivative_of','headingLabel','structuredContent','referenceText','decision_method','decision_outcome','number_of_votes_favor','number_of_votes_against','number_of_votes_abstention','decided_on_a_realization_of'];
export function topicWorkFields(db){
 const entries="json_each(CASE WHEN o.type='array' THEN o.value WHEN o.type='object' THEN json_array(json(o.value)) ELSE json_array(o.value) END)";
 const query=db.prepare(`SELECT json_group_object(key,CASE
 WHEN key='is_realized_by' THEN json((SELECT json_group_array(json_object('title',CASE WHEN e.type='object' THEN json_extract(e.value,'$.title') END)) FROM ${entries} e))
 WHEN key='recorded_in_a_realization_of' THEN json((SELECT json_group_array(CASE WHEN e.type='object' THEN json_object('id',json_extract(e.value,'$.id'),'identifier',json_extract(e.value,'$.identifier'),'is_part_of',json_extract(e.value,'$.is_part_of'),'originalLanguage',json_extract(e.value,'$.originalLanguage'),'number',json_extract(e.value,'$.number')) ELSE e.value END) FROM ${entries} e))
 WHEN type IN ('object','array') THEN json(value) ELSE value END) body FROM json_each(?) o WHERE key IN (${fields.map(f=>"'"+f+"'").join(',')})`);
 return json=>JSON.parse(query.get(json).body);
}
