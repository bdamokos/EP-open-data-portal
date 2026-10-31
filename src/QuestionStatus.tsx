import {UiMessage, useUiI18n} from './UiI18nReact';
import './QuestionStatus.css';

export function QuestionStatus({answered}:{answered:boolean}) {
  const ui = useUiI18n();
  return <span className="explorer-question-status" data-answered={answered}>
    <span className="explorer-question-status-icon" aria-hidden="true">{answered ? '✓' : '○'}</span>
    <span>{answered ? <UiMessage id="questionStatus.1"/> : <UiMessage id="questionStatus.2"/>}</span>
  </span>;
}
