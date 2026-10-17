import './QuestionStatus.css';

export function QuestionStatus({answered}:{answered:boolean}) {
  return <span className="explorer-question-status" data-answered={answered}>
    <span className="explorer-question-status-icon" aria-hidden="true">{answered?'✓':'○'}</span>
    <span>{answered?'Answered':'Awaiting answer'}</span>
  </span>;
}
