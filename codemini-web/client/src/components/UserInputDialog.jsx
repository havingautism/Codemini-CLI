import { useEffect, useMemo, useRef, useState } from 'react';
import { Wrench } from '@/lib/icons';
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
import { Field, FieldContent, FieldGroup, FieldLabel } from '@/components/ui/field';
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
    <span className="flex min-w-0 flex-col">
      <span className="text-[13px] text-(--text-primary)">{option.label}</span>
      {option.description && (
        <span className="text-[11px] leading-4 text-(--text-muted)">{option.description}</span>
      )}
    </span>
  );
}

function ChoiceRow({ control, id, option, disabled }) {
  return (
    <FieldLabel
      htmlFor={disabled ? undefined : id}
      className={cn(
        "w-full items-start gap-2.5 rounded-md border border-(--border-default) px-3 py-2 font-normal",
        disabled ? "cursor-default" : "cursor-pointer transition-colors hover:bg-(--bg-hover)",
      )}
    >
      {control}
      <OptionLabel option={option} />
    </FieldLabel>
  );
}

function QuestionField({ question, value, other, onChange, onOtherChange, disabled = false }) {
  const options = Array.isArray(question.options) ? question.options : [];
  const showOther = question.allow_other && (
    question.type === 'checkbox' ? value.includes(OTHER_VALUE) : value === OTHER_VALUE
  );

  return (
    <Field className="flex-col gap-2">
      <FieldLabel className="w-auto text-[13px] font-medium leading-5 text-(--text-primary)">
        {question.label}
        {question.required && !disabled && <span className="ml-1 text-(--accent-red)">*</span>}
      </FieldLabel>
      <FieldContent>

      {question.type === 'text' && (question.multiline ? (
        <Textarea disabled={disabled} value={value} placeholder={question.placeholder || ''} onChange={(event) => onChange(event.target.value)} />
      ) : (
        <Input disabled={disabled} value={value} placeholder={question.placeholder || ''} onChange={(event) => onChange(event.target.value)} />
      ))}

      {question.type === 'select' && (
        <Select value={value} onValueChange={onChange} disabled={disabled}>
          <SelectTrigger className="w-full">
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
              id={`${question.id}-${option.value}`}
              option={option}
              disabled={disabled}
              control={<RadioGroupItem disabled={disabled} id={`${question.id}-${option.value}`} value={option.value} className="mt-0.5" />}
            />
          ))}
          {question.allow_other && (
            <ChoiceRow
              id={`${question.id}-${OTHER_VALUE}`}
              option={{ label: t('userInputOther') }}
              disabled={disabled}
              control={<RadioGroupItem disabled={disabled} id={`${question.id}-${OTHER_VALUE}`} value={OTHER_VALUE} className="mt-0.5" />}
            />
          )}
        </RadioGroup>
      )}

      {question.type === 'checkbox' && (
        <FieldGroup className="gap-2">
          {[...options, ...(question.allow_other ? [{ label: t('userInputOther'), value: OTHER_VALUE }] : [])].map((option) => (
            <ChoiceRow
              key={option.value}
              id={`${question.id}-${option.value}`}
              option={option}
              disabled={disabled}
              control={<Checkbox
                id={`${question.id}-${option.value}`}
                disabled={disabled}
                checked={value.includes(option.value)}
                onCheckedChange={() => onChange(
                  value.includes(option.value)
                    ? value.filter((item) => item !== option.value)
                    : [...value, option.value],
                )}
                className="mt-0.5"
              />}
            />
          ))}
        </FieldGroup>
      )}

      {showOther && (
        <Input
          autoFocus={!disabled}
          disabled={disabled}
          value={other}
          placeholder={t('userInputOtherPlaceholder')}
          onChange={(event) => onOtherChange(event.target.value)}
        />
      )}
      </FieldContent>
    </Field>
  );
}

function knownOptionValues(question) {
  return new Set((question.options || []).map((option) => option.value));
}

function formStateFromResult(questions = [], result = null) {
  const answers = initialAnswers(questions);
  const other = {};
  if (!result || result.status === 'skipped') {
    return { answers, other, custom: '' };
  }
  const custom = String(result.custom_response || '').trim();
  if (custom) return { answers, other, custom };
  const incoming = result.answers && typeof result.answers === 'object' ? result.answers : {};
  for (const question of questions) {
    const raw = incoming[question.id];
    if (question.type === 'checkbox') {
      const items = Array.isArray(raw) ? raw : [];
      const known = knownOptionValues(question);
      const selected = [];
      const extras = [];
      for (const item of items) {
        if (known.has(item)) selected.push(item);
        else extras.push(String(item));
      }
      if (extras.length && question.allow_other) {
        selected.push(OTHER_VALUE);
        other[question.id] = extras.join('、');
      }
      answers[question.id] = selected;
      continue;
    }
    const text = Array.isArray(raw) ? String(raw[0] || '').trim() : String(raw || '').trim();
    if (!text) continue;
    const known = knownOptionValues(question);
    if (['select', 'radio'].includes(question.type) && question.allow_other && !known.has(text)) {
      answers[question.id] = OTHER_VALUE;
      other[question.id] = text;
    } else {
      answers[question.id] = text;
    }
  }
  return { answers, other, custom: '' };
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
  const questions = useMemo(() => normalizeQuestions(request?.questions), [request]);
  const [answers, setAnswers] = useState(() => initialAnswers(questions));
  const [otherAnswers, setOtherAnswers] = useState({});
  const [customResponseOpen, setCustomResponseOpen] = useState(false);
  const [customResponse, setCustomResponse] = useState('');
  const [submitting, setSubmitting] = useState(false);
  const submittingRef = useRef(false);
  const readOnly = Boolean(result) || typeof onRespond !== 'function';
  const hydrated = useMemo(() => formStateFromResult(questions, result), [questions, result]);
  const formAnswers = readOnly ? hydrated.answers : answers;
  const formOther = readOnly ? hydrated.other : otherAnswers;
  const formCustom = readOnly ? hydrated.custom : customResponse;
  const showCustom = readOnly ? Boolean(hydrated.custom) : customResponseOpen;

  useEffect(() => {
    if (readOnly) return;
    setAnswers(initialAnswers(questions));
    setOtherAnswers({});
    setCustomResponseOpen(false);
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
  return (
    <section className="codemini-message-surface overflow-hidden rounded-[16px] border border-(--border-default) px-4 py-3.5">
      <div className="mb-3 flex items-start gap-2">
        <span className="mt-0.5 flex size-[18px] shrink-0 items-center justify-center rounded text-(--text-process-detail)">
          <Wrench size={14} />
        </span>
        <div className="min-w-0 flex-1">
          <div className="text-[13px] font-medium leading-5 text-(--text-primary)">
            {request.title || t('userInputTitle')}
          </div>
          {request.description ? (
            <p className="pt-1 text-[13px] leading-5 text-(--text-secondary)">{request.description}</p>
          ) : null}
        </div>
        <span
          aria-hidden="true"
          className={`mt-1.5 h-1.5 w-1.5 shrink-0 rounded-full ${
            done ? 'bg-[var(--accent-green)]' : 'bg-[var(--accent-orange)]'
          }`}
        />
      </div>
      <div className="flex flex-col gap-4">
        {result?.status === 'skipped' && (
          <p className="text-[13px] leading-5 text-(--text-muted)">{t('userInputSkipped')}</p>
        )}
        <FieldGroup className="gap-5">
          {questions.map((question) => (
            <QuestionField
              key={question.id}
              question={question}
              disabled={readOnly}
              value={formAnswers[question.id] ?? (question.type === 'checkbox' ? [] : '')}
              other={formOther[question.id] || ''}
              onChange={(value) => setAnswers((current) => ({ ...current, [question.id]: value }))}
              onOtherChange={(value) => setOtherAnswers((current) => ({ ...current, [question.id]: value }))}
            />
          ))}
        </FieldGroup>
        {showCustom && (
          <div className="rounded-lg border border-(--border-default) bg-(--bg-secondary) p-3">
            <label htmlFor="user-input-custom-response" className="mb-2 block text-[12px] font-medium text-(--text-secondary)">
              {t('userInputCustomPrompt')}
            </label>
            <Textarea
              id="user-input-custom-response"
              autoFocus={!readOnly}
              disabled={readOnly}
              value={formCustom}
              placeholder={t('userInputCustomPlaceholder')}
              onChange={(event) => setCustomResponse(event.target.value)}
              className="min-h-20 bg-(--bg-primary)"
            />
          </div>
        )}
        {!readOnly && (
          <div className="flex flex-col-reverse gap-2 sm:flex-row sm:justify-end">
            {customResponseOpen ? (
              <>
                <Button variant="ghost" disabled={submitting} onClick={() => setCustomResponseOpen(false)}>
                  {t('cancel')}
                </Button>
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
                <Button variant="ghost" disabled={submitting} onClick={() => setCustomResponseOpen(true)}>
                  {t('userInputCustom')}
                </Button>
                <Button disabled={missingRequired || submitting} onClick={() => respond('submitted')}>
                  {request.submit_label || t('userInputSubmit')}
                </Button>
              </>
            )}
          </div>
        )}
      </div>
    </section>
  );
}
