import './PocQuestionStatus.css';

export function QuestionStatus({answered}:{answered:boolean}) {
  return <span className="poc-question-status" data-answered={answered}>
    <span className="poc-question-status-icon" aria-hidden="true">{answered?'✓':'○'}</span>
    <span>{answered?'Answered':'Awaiting answer'}</span>
  </span>;
}
