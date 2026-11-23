import { useEffect, useId, useMemo, useRef, useState } from 'react';
import { CaretDown, CaretUp, Check, X } from '@/lib/icons';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Textarea } from '@/components/ui/textarea';
import {
  Select,
  SelectContent,
  SelectGroup,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import { Checkbox } from '@/components/ui/checkbox';
import { RadioGroup, RadioGroupItem } from '@/components/ui/radio-group';
import { FieldContent, FieldGroup } from '@/components/ui/field';
import GlideMenu from '@/components/beautiful-ui/GlideMenu.jsx';
import { parseMaybeJson } from '@/lib/tool-card-display.js';
import { cn } from '@/lib/utils';
import { t } from '../../i18n/index.js';
import './beautiful-ui/ApprovalQuestion.css';

function initialAnswers(questions = []) {
  return Object.fromEntries(questions.map((question) => [
    question.id,
    question.type === 'checkbox' ? [] : '',
  ]));
}

function OptionLabel({ option }) {
  return (
    <span className="flex min-w-0 flex-col gap-0.5 break-words">
      <span className="text-[13px] font-medium leading-5 text-(--text-primary)">{option.label}</span>
      {option.description && (
        <span data-option-description className="text-[12px] leading-5 text-(--text-secondary)">{option.description}</span>
      )}
    </span>
  );
}

function ChoiceRow({ control, id, option, selected }) {
  return (
    <label
      htmlFor={id}
      data-selected={selected}
      data-menu-row
      className="codemini-question-choice"
    >
      {control}
      <OptionLabel option={option} />
    </label>
  );
}

function QuestionField({ question, value, other, onChange, onOtherChange, disabled = false, hideHeading = false }) {
  const fieldId = useId();
  const options = Array.isArray(question.options) ? question.options : [];

  return (
    <fieldset className="min-w-0">
      <legend className={hideHeading ? "sr-only" : "codemini-question-heading"}>
        {question.label}
      </legend>
      {question.type === 'checkbox' && <p className="mb-1 text-xs text-(--text-muted)">{t('userInputMultiple')}</p>}
      {question.required && <span className="sr-only">{t('userInputRequired')}</span>}
      <FieldContent>

        {question.type === 'text' && (question.multiline ? (
          <Textarea aria-label={question.label} disabled={disabled} value={value} placeholder={question.placeholder || ''} onChange={(event) => onChange(event.target.value)} />
        ) : (
          <Input aria-label={question.label} disabled={disabled} value={value} placeholder={question.placeholder || ''} onChange={(event) => onChange(event.target.value)} />
        ))}

        {question.type === 'select' && (
          <Select value={value} onValueChange={onChange} disabled={disabled}>
            <SelectTrigger aria-label={question.label} className="w-full [&_[data-option-description]]:hidden">
              <SelectValue placeholder={question.placeholder || t('userInputSelectPlaceholder')} />
            </SelectTrigger>
            <SelectContent position="popper" className="max-w-[min(32rem,calc(100vw-2rem))]">
              <SelectGroup>
                {options.map((option) => (
                  <SelectItem key={option.value} value={option.value}><OptionLabel option={option} /></SelectItem>
                ))}
              </SelectGroup>
            </SelectContent>
          </Select>
        )}

        {question.type === 'radio' && (
          <RadioGroup value={value} onValueChange={onChange} disabled={disabled} aria-label={question.label}>
            <GlideMenu className="flex flex-col gap-0.5">
              {options.map((option) => (
                <ChoiceRow
                  key={option.value}
                  id={`${fieldId}-${option.value}`}
                  option={option}
                  selected={value === option.value}
                  control={<RadioGroupItem disabled={disabled} id={`${fieldId}-${option.value}`} value={option.value} className="mt-0.5 border-(--text-muted) text-(--accent-blue) data-[state=checked]:border-(--accent-blue) disabled:opacity-100" />}
                />
              ))}
            </GlideMenu>
          </RadioGroup>
        )}

        {question.type === 'checkbox' && (
          <FieldGroup className="gap-0.5">
            {options.map((option) => (
              <ChoiceRow
                key={option.value}
                id={`${fieldId}-${option.value}`}
                option={option}
                selected={value.includes(option.value)}
                control={<Checkbox
                  id={`${fieldId}-${option.value}`}
                  disabled={disabled}
                  checked={value.includes(option.value)}
                  onCheckedChange={() => onChange(
                    value.includes(option.value)
                      ? value.filter((item) => item !== option.value)
                      : [...value, option.value],
                  )}
                  className="mt-0.5 border-(--text-muted) data-[state=checked]:border-(--accent-blue) data-[state=checked]:bg-(--accent-blue) data-[state=checked]:text-white disabled:opacity-100"
                />}
              />
            ))}
          </FieldGroup>
        )}

        {question.allow_other && (
          <Input
            aria-label={`${question.label} — ${t('userInputOtherPlaceholder')}`}
            className="codemini-question-other"
            disabled={disabled}
            value={other}
            placeholder={t('userInputOtherPlaceholder')}
            onChange={(event) => onOtherChange(event.target.value)}
          />
        )}
      </FieldContent>
    </fieldset>
  );
}

function settledQuestionValues(question, answer) {
  const values = (Array.isArray(answer) ? answer : [answer])
    .filter((value) => value != null && value !== '')
    .map(String);
  if (question.type === 'text') return { value: values.join('\n'), other: '' };

  const options = new Set(question.options?.map((option) => option.value));
  const selected = [];
  const supplements = [];
  for (const value of values) {
    if (options.has(value) && !selected.includes(value) &&
      (question.type === 'checkbox' || !selected.length)) {
      selected.push(value);
    } else {
      supplements.push(value);
    }
  }
  return {
    value: question.type === 'checkbox' ? selected : selected[0] || '',
    other: supplements.join(' · '),
  };
}

function normalizeQuestions(questions = []) {
  return (Array.isArray(questions) ? questions : []).map((question, index) => {
    const options = (Array.isArray(question?.options) ? question.options : [])
      .map((option) => ({
        label: String(option?.label || option?.value || '').trim(),
        value: String(option?.value || option?.label || '').trim(),
        ...(String(option?.description || '').trim()
          ? { description: String(option.description).trim() }
          : {}),
      }))
      .filter((option) => option.label && option.value);
    const type = ['text', 'select', 'radio', 'checkbox'].includes(question?.type)
      ? question.type
      : question?.multi_select === true
        ? 'checkbox'
        : options.length > 0
          ? 'radio'
          : 'text';
    return {
      id: String(question?.id || `question_${index + 1}`).trim(),
      label: String(question?.question || question?.label || `Question ${index + 1}`).trim(),
      type,
      required: question?.required === true,
      multiline: type === 'text' && question?.multiline === true,
      allow_other: ['select', 'radio', 'checkbox'].includes(type) && question?.allow_other !== false,
      ...(String(question?.placeholder || '').trim() ? { placeholder: String(question.placeholder).trim() } : {}),
      ...(options.length ? { options } : {}),
    };
  }).filter((question) => question.id && question.label);
}

export function requestFromToolCard(card) {
  const parsed = parseMaybeJson(card?.arguments) || {};
  return {
    title: String(parsed.title || '').trim(),
    description: String(parsed.description || '').trim(),
    questions: normalizeQuestions(parsed.questions),
    submit_label: String(parsed.submit_label || '').trim(),
  };
}

export function resultFromToolCard(card) {
  const parsed = parseMaybeJson(card?.result);
  return parsed && typeof parsed === 'object' && !Array.isArray(parsed) ? parsed : null;
}

// The one-question layout follows Beautiful UI's ApprovalCard. See beautiful-ui/LICENSE.
export function UserInputCard({ request, result = null, onRespond }) {
  const questions = useMemo(() => normalizeQuestions(request?.questions), [request?.questions]);
  const [answers, setAnswers] = useState(() => initialAnswers(questions));
  const [otherAnswers, setOtherAnswers] = useState({});
  const [page, setPage] = useState(0);
  const [direction, setDirection] = useState(1);
  const [customResponse, setCustomResponse] = useState('');
  const [submitting, setSubmitting] = useState(false);
  const submittingRef = useRef(false);
  const readOnly = Boolean(result) || typeof onRespond !== 'function';

  useEffect(() => {
    setAnswers(initialAnswers(questions));
    setOtherAnswers({});
    setPage(0);
    setDirection(1);
    setCustomResponse('');
    submittingRef.current = false;
    setSubmitting(false);
  }, [request?.id, questions]);

  if (!request) return null;

  const normalizedAnswers = Object.fromEntries(questions.flatMap((question) => {
    const value = answers[question.id];
    const other = String(otherAnswers[question.id] || '').trim();
    if (question.type === 'checkbox') {
      const selected = Array.isArray(value) ? value : [];
      const resolved = other ? [...selected, other] : selected;
      return resolved.length ? [[question.id, resolved]] : [];
    }
    const selected = String(value || '').trim();
    const resolved = selected && other ? [selected, other] : selected || other;
    return resolved ? [[question.id, resolved]] : [];
  }));

  const missingRequired = questions.some((question) => question.required && !normalizedAnswers[question.id]);
  const pageIndex = Math.min(page, Math.max(questions.length - 1, 0));
  const question = questions[pageIndex];
  const last = pageIndex >= questions.length - 1;
  const title = String(request.title || '').trim();
  const customTitle = /^need your input$/i.test(title) || title === t('userInputTitle') ? '' : title;
  const label = customTitle || question?.label || t('userInputTitle');
  const canContinue = !question
    ? Boolean(customResponse.trim())
    : last
      ? !missingRequired
      : !question.required || Boolean(normalizedAnswers[question.id]);

  function goTo(index) {
    if (index < 0 || index >= questions.length || index === pageIndex) return;
    setDirection(index > pageIndex ? 1 : -1);
    setPage(index);
  }

  function respond(status, response = {}) {
    if (readOnly || submittingRef.current) return;
    submittingRef.current = true;
    setSubmitting(true);
    onRespond(request.id, {
      status,
      answers: status === 'skipped' ? {} : normalizedAnswers,
      ...response,
    });
  }

  const navigationLocked = !result && submitting;
  const pager = questions.length > 1 && (
    <div className="flex items-center gap-1 text-xs tabular-nums text-(--text-muted)">
      <button type="button" className="codemini-question-icon" aria-label={t('userInputPreviousQuestion')} disabled={pageIndex === 0 || navigationLocked} onClick={() => goTo(pageIndex - 1)}><CaretUp size={14} aria-hidden="true" /></button>
      <span aria-live="polite">{pageIndex + 1}/{questions.length}</span>
      <button type="button" className="codemini-question-icon" aria-label={t('userInputNextQuestion')} disabled={last || navigationLocked} onClick={() => goTo(pageIndex + 1)}><CaretDown size={14} aria-hidden="true" /></button>
    </div>
  );

  if (result) {
    const skipped = result.status === 'skipped';
    const status = t(skipped ? 'userInputSkipped' : 'userInputSubmitted');
    const custom = String(result.custom_response || '').trim();
    const heading = customTitle || question?.label || request.description || t('userInputCustom');
    return (
      <section className="codemini-question-card" aria-label={label}>
        <div className="flex items-start justify-between gap-3">
          <h3 className="min-w-0 wrap-anywhere text-[14px] font-semibold">{heading}</h3>
          <span className={cn('inline-flex shrink-0 items-center gap-1 rounded-full px-2 py-0.5 text-xs', skipped ? 'bg-(--bg-hover) text-(--text-secondary)' : 'bg-(--accent-green-bg) text-(--accent-green)')}>
            {!skipped && <Check size={13} aria-hidden="true" />}
            {status}
          </span>
        </div>
        {request.description && request.description !== heading && <p className="mt-1 text-xs text-(--text-muted)">{request.description}</p>}
        {custom ? (
          <Textarea className="codemini-question-other mt-3" aria-label={t('userInputCustom')} value={custom} disabled />
        ) : question ? (
          <div key={question.id} className="codemini-question-review codemini-question-page mt-3" data-direction={direction}>
            <QuestionField
              question={question}
              hideHeading={question.label === heading}
              {...settledQuestionValues(question, skipped ? undefined : result.answers?.[question.id])}
              disabled
            />
          </div>
        ) : null}
        {!custom && pager && <div className="codemini-question-footer">{pager}</div>}
      </section>
    );
  }

  return (
    <section className="codemini-question-card relative" aria-label={label}>
      {!readOnly && (
        <button type="button" className="codemini-question-icon codemini-question-close" aria-label={t('userInputSkipRequest')} title={t('userInputSkipRequest')} disabled={submitting} onClick={() => respond('skipped')}>
          <X size={15} aria-hidden="true" />
        </button>
      )}
      <span className="sr-only" aria-live="polite">
        {question ? `${pageIndex + 1}/${questions.length} ${question.label}` : t('userInputCustom')}
      </span>
      <div key={question?.id ?? 'custom'} className="codemini-question-page" data-direction={direction}>
        {!question ? (
          <>
            {request.description && <p className="mb-2 text-xs text-(--text-secondary)">{request.description}</p>}
            <Textarea
              aria-label={label}
              disabled={readOnly || submitting}
              value={customResponse}
              placeholder={t('userInputCustomPlaceholder')}
              onChange={(event) => setCustomResponse(event.target.value)}
              className="codemini-question-other min-h-16"
            />
          </>
        ) : (
          <>
            <QuestionField
              question={question}
              disabled={readOnly || submitting}
              value={answers[question.id] ?? (question.type === 'checkbox' ? [] : '')}
              other={otherAnswers[question.id] || ''}
              onChange={(value) => setAnswers((current) => ({ ...current, [question.id]: value }))}
              onOtherChange={(value) => setOtherAnswers((current) => ({ ...current, [question.id]: value }))}
            />
            {request.description && <p className="mt-2 text-xs text-(--text-muted)">{request.description}</p>}
          </>
        )}
      </div>
      <div className="codemini-question-footer">
        {pager}
        {readOnly ? (
          <span className="text-xs text-(--text-muted)">{t('userInputUnavailable')}</span>
        ) : (
          <div className="ml-auto flex items-center gap-2">
            <Button type="button" variant="secondary" size="sm" className="rounded-full" disabled={submitting} onClick={() => last ? respond('skipped') : goTo(pageIndex + 1)}>
              {t('userInputSkip')}
            </Button>
            <Button
              type="button"
              size="sm"
              className="rounded-full"
              disabled={submitting || !canContinue}
              onClick={() => {
                if (!question) respond('submitted', { custom_response: customResponse.trim() });
                else if (last) respond('submitted');
                else goTo(pageIndex + 1);
              }}
            >
              {(last && request.submit_label) || t('userInputSubmit')}
            </Button>
          </div>
        )}
      </div>
      {!readOnly && question && !canContinue && (
        <p className="mt-1.5 text-xs text-(--text-muted)">{t('userInputRequiredHint')}</p>
      )}
    </section>
  );
}
