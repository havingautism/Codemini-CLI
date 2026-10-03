import { useEffect, useId, useMemo, useRef, useState } from 'react';
import { ChatCircle, Check } from '@/lib/icons';
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
import { FieldContent, FieldGroup, FieldLabel } from '@/components/ui/field';
import { parseMaybeJson } from '@/lib/tool-card-display.js';
import { cn } from '@/lib/utils';
import { t } from '../../i18n/index.js';

const OTHER_VALUE = '__codemini_other__';

function initialAnswers(questions = []) {
  return Object.fromEntries(questions.map((question) => [
    question.id,
    question.type === 'checkbox' ? [] : '',
  ]));
}

function OptionLabel({ option }) {
  return (
    <span className="flex min-w-0 flex-col gap-0.5">
      <span className="text-[13px] font-medium leading-5 text-(--text-primary)">{option.label}</span>
      {option.description && (
        <span data-option-description className="text-[12px] leading-5 text-(--text-secondary)">{option.description}</span>
      )}
    </span>
  );
}

function ChoiceRow({ control, id, option, disabled, selected }) {
  return (
    <FieldLabel
      htmlFor={disabled ? undefined : id}
      data-selected={selected}
      className={cn(
        "w-full min-h-11 items-start gap-3 rounded-lg border px-3 py-2.5 font-normal has-[:focus-visible]:ring-2 has-[:focus-visible]:ring-(--accent-blue)",
        selected
          ? "border-(--accent-blue) bg-(--accent-blue-bg)"
          : "border-(--border-default) bg-(--bg-primary)",
        disabled ? "cursor-default" : selected ? "cursor-pointer transition-colors" : "cursor-pointer transition-colors hover:bg-(--bg-hover)",
      )}
    >
      {control}
      <OptionLabel option={option} />
    </FieldLabel>
  );
}

function QuestionField({ question, index, value, other, onChange, onOtherChange, disabled = false }) {
  const fieldId = useId();
  const options = Array.isArray(question.options) ? question.options : [];
  const showOther = question.allow_other && (
    question.type === 'checkbox' ? value.includes(OTHER_VALUE) : value === OTHER_VALUE
  );

  return (
    <fieldset className="min-w-0 space-y-2.5">
      <legend className="mb-1 flex w-full items-start gap-2.5 text-[13px] font-semibold leading-5 text-(--text-primary)">
        <span aria-hidden="true" className="flex size-5 shrink-0 items-center justify-center rounded-md bg-(--bg-hover) text-[11px] text-(--text-secondary)">{index + 1}</span>
        <span className="min-w-0 flex-1">{question.label}</span>
      </legend>
      <div className="flex gap-2 text-[11px] leading-4 text-(--text-muted)">
        {['radio', 'select', 'checkbox'].includes(question.type) && <span>{t(question.type === 'checkbox' ? 'userInputMultiple' : 'userInputSingle')}</span>}
        {question.required && <span className="text-(--accent-orange)">{t('userInputRequired')}</span>}
      </div>
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
                {question.allow_other && <SelectItem value={OTHER_VALUE}>{t('userInputOther')}</SelectItem>}
              </SelectGroup>
            </SelectContent>
          </Select>
        )}

        {question.type === 'radio' && (
          <RadioGroup value={value} onValueChange={disabled ? undefined : onChange} disabled={disabled} className="gap-2">
            {options.map((option) => (
              <ChoiceRow
                key={option.value}
                id={`${fieldId}-${option.value}`}
                option={option}
                disabled={disabled}
                selected={value === option.value}
                control={<RadioGroupItem disabled={disabled} id={`${fieldId}-${option.value}`} value={option.value} className="mt-0.5 border-(--text-muted) text-(--accent-blue) data-[state=checked]:border-(--accent-blue) disabled:opacity-100" />}
              />
            ))}
            {question.allow_other && (
              <ChoiceRow
                id={`${fieldId}-${OTHER_VALUE}`}
                option={{ label: t('userInputOther') }}
                disabled={disabled}
                selected={value === OTHER_VALUE}
                control={<RadioGroupItem disabled={disabled} id={`${fieldId}-${OTHER_VALUE}`} value={OTHER_VALUE} className="mt-0.5 border-(--text-muted) text-(--accent-blue) data-[state=checked]:border-(--accent-blue) disabled:opacity-100" />}
              />
            )}
          </RadioGroup>
        )}

        {question.type === 'checkbox' && (
          <FieldGroup className="gap-2">
            {[...options, ...(question.allow_other ? [{ label: t('userInputOther'), value: OTHER_VALUE }] : [])].map((option) => (
              <ChoiceRow
                key={option.value}
                id={`${fieldId}-${option.value}`}
                option={option}
                disabled={disabled}
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

        {showOther && (
          <Input
            aria-label={`${question.label} — ${t('userInputOther')}`}
            autoFocus={!disabled}
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

export function UserInputCard({ request, result = null, onRespond }) {
  const customId = useId();
  const questions = useMemo(() => normalizeQuestions(request?.questions), [request]);
  const [answers, setAnswers] = useState(() => initialAnswers(questions));
  const [otherAnswers, setOtherAnswers] = useState({});
  const [customResponseOpen, setCustomResponseOpen] = useState(questions.length === 0);
  const [customResponse, setCustomResponse] = useState('');
  const [submitting, setSubmitting] = useState(false);
  const submittingRef = useRef(false);
  const readOnly = Boolean(result) || typeof onRespond !== 'function';
  const formCustom = readOnly ? String(result?.custom_response || '').trim() : customResponse;
  const showCustom = readOnly ? Boolean(formCustom) : customResponseOpen;

  useEffect(() => {
    if (readOnly) return;
    setAnswers(initialAnswers(questions));
    setOtherAnswers({});
    setCustomResponseOpen(questions.length === 0);
    setCustomResponse('');
    submittingRef.current = false;
    setSubmitting(false);
  }, [request?.id, questions, readOnly]);

  if (!request) return null;

  const normalizedAnswers = () => Object.fromEntries(questions.flatMap((question) => {
    const value = answers[question.id];
    if (question.type === 'checkbox') {
      const resolved = (Array.isArray(value) ? value : []).flatMap((item) => (
        item === OTHER_VALUE ? [String(otherAnswers[question.id] || '').trim()].filter(Boolean) : [item]
      ));
      return resolved.length ? [[question.id, resolved]] : [];
    }
    const resolved = value === OTHER_VALUE ? String(otherAnswers[question.id] || '').trim() : String(value || '').trim();
    return resolved ? [[question.id, resolved]] : [];
  }));

  const missingRequired = questions.some((question) => {
    if (!question.required) return false;
    const value = normalizedAnswers()[question.id];
    return Array.isArray(value) ? value.length === 0 : !value;
  });

  const respond = (status, response = {}) => {
    if (readOnly || submittingRef.current) return;
    submittingRef.current = true;
    setSubmitting(true);
    onRespond(request.id, {
      status,
      answers: status === 'skipped' ? {} : normalizedAnswers(),
      ...response,
    });
  };

  const done = Boolean(result);
  const answeredCount = Object.keys(normalizedAnswers()).length;
  const summaryAnswers = result?.answers || {};
  const statusLabel = done
    ? t(result.status === 'skipped' ? 'userInputSkipped' : 'userInputSubmitted')
    : t(readOnly ? 'userInputUnavailable' : 'userInputWaiting');
  return (
    <section className="codemini-message-surface overflow-hidden rounded-2xl border border-(--border-default)">
      <div className="flex items-start gap-3 border-b border-(--border-default) px-4 py-3.5">
        <span className="flex size-8 shrink-0 items-center justify-center rounded-lg bg-(--accent-blue-bg) text-(--accent-blue)">
          {done ? <Check size={16} /> : <ChatCircle size={16} />}
        </span>
        <div className="min-w-0 flex-1">
          <div className="text-[13px] font-semibold leading-5 text-(--text-primary)">
            {request.title || t('userInputTitle')}
          </div>
          {(request.description || !readOnly) && (
            <p className="pt-0.5 text-[12px] leading-5 text-(--text-secondary)">
              {request.description || t('userInputHint')}
            </p>
          )}
        </div>
        <span className={cn("shrink-0 rounded-full px-2 py-0.5 text-[11px] leading-5", done ? "bg-(--accent-green-bg) text-(--accent-green)" : "bg-(--bg-hover) text-(--text-secondary)")}>
          {statusLabel}
        </span>
      </div>
      <div className="flex flex-col gap-4 px-4 py-4">
        {result?.status === 'skipped' && (
          <p className="text-[13px] leading-5 text-(--text-muted)">{t('userInputSkipped')}</p>
        )}
        {!readOnly && questions.length > 0 && (
          <div className="flex w-fit max-w-full flex-wrap gap-1 rounded-lg bg-(--bg-hover) p-1" role="group" aria-label={t('userInputAnswerMode')}>
            <Button variant="ghost" size="sm" disabled={submitting} aria-pressed={!customResponseOpen} className={cn("h-8 text-[12px]", !customResponseOpen && "bg-(--bg-primary) shadow-sm")} onClick={() => setCustomResponseOpen(false)}>{t('userInputChooseOptions')}</Button>
            <Button variant="ghost" size="sm" disabled={submitting} aria-pressed={customResponseOpen} className={cn("h-8 text-[12px]", customResponseOpen && "bg-(--bg-primary) shadow-sm")} onClick={() => setCustomResponseOpen(true)}>{t('userInputCustom')}</Button>
          </div>
        )}
        {done && result.status !== 'skipped' && !formCustom && (
          <dl className="space-y-4">
            {questions.map((question) => {
              const raw = summaryAnswers[question.id];
              const values = Array.isArray(raw) ? raw : raw == null || raw === '' ? [] : [raw];
              return (
                <div key={question.id}>
                  <dt className="text-[12px] leading-5 text-(--text-secondary)">{question.label}</dt>
                  <dd className="mt-1 whitespace-pre-wrap break-words text-[13px] font-medium leading-5 text-(--text-primary)">
                    {values.length ? values.map((value) => question.options?.find((option) => option.value === value)?.label || String(value)).join('、') : t('userInputUnanswered')}
                  </dd>
                </div>
              );
            })}
          </dl>
        )}
        {!done && !showCustom && (
          <FieldGroup className="gap-5">
            {questions.map((question, index) => (
              <QuestionField
                key={question.id}
                question={question}
                index={index}
                disabled={readOnly || submitting}
                value={answers[question.id] ?? (question.type === 'checkbox' ? [] : '')}
                other={otherAnswers[question.id] || ''}
                onChange={(value) => setAnswers((current) => ({ ...current, [question.id]: value }))}
                onOtherChange={(value) => setOtherAnswers((current) => ({ ...current, [question.id]: value }))}
              />
            ))}
          </FieldGroup>
        )}
        {showCustom && (
          <div className="rounded-lg border border-(--border-default) bg-(--bg-secondary) p-3">
            <label htmlFor={customId} className="mb-2 block text-[12px] font-medium text-(--text-secondary)">
              {readOnly ? t('userInputCustom') : t('userInputCustomPrompt')}
            </label>
            {readOnly ? (
              <p className="whitespace-pre-wrap break-words text-[13px] leading-5 text-(--text-primary)">{formCustom}</p>
            ) : <Textarea
              id={customId}
              autoFocus={!readOnly}
              disabled={readOnly || submitting}
              value={formCustom}
              placeholder={t('userInputCustomPlaceholder')}
              onChange={(event) => setCustomResponse(event.target.value)}
              className="min-h-24 bg-(--bg-primary)"
            />}
          </div>
        )}
        {!readOnly && (
          <div className="flex flex-wrap items-center justify-between gap-3 border-t border-(--border-default) pt-3">
            <span aria-live="polite" className="text-[12px] text-(--text-muted)">{customResponseOpen ? t('userInputCustomModeHint') : `${t('userInputProgress')} ${answeredCount}/${questions.length}${missingRequired ? ` · ${t('userInputRequiredHint')}` : ''}`}</span>
            <div className="flex flex-wrap items-center gap-2">
              {customResponseOpen ? (
                <>
                  <Button
                    disabled={submitting || !customResponse.trim()}
                    onClick={() => respond('submitted', { custom_response: customResponse.trim(), answers: {} })}
                  >
                    {t('userInputCustomSubmit')}
                  </Button>
                </>
              ) : (
                <>
                  <Button variant="outline" disabled={submitting} onClick={() => respond('skipped')}>
                    {t('userInputSkip')}
                  </Button>
                  <Button disabled={missingRequired || submitting} onClick={() => respond('submitted')}>
                    {request.submit_label || t('userInputSubmit')}
                  </Button>
                </>
              )}
            </div>
          </div>
        )}
      </div>
    </section>
  );
}
