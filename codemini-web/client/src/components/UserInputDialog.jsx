import { useEffect, useMemo, useRef, useState } from 'react';
import { Dialog, DialogContent, DialogFooter, DialogHeader, DialogTitle } from '@/components/ui/dialog';
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

function ChoiceRow({ control, id, option }) {
  return (
    <FieldLabel htmlFor={id} className="w-full cursor-pointer items-start gap-2.5 rounded-md border border-(--border-default) px-3 py-2 font-normal transition-colors hover:bg-(--bg-hover)">
      {control}
      <OptionLabel option={option} />
    </FieldLabel>
  );
}

function QuestionField({ question, value, other, onChange, onOtherChange }) {
  const options = Array.isArray(question.options) ? question.options : [];
  const showOther = question.allow_other && (
    question.type === 'checkbox' ? value.includes(OTHER_VALUE) : value === OTHER_VALUE
  );

  return (
    <Field className="flex-col gap-2">
      <FieldLabel className="w-auto text-[13px] font-medium leading-5 text-(--text-primary)">
        {question.label}
        {question.required && <span className="ml-1 text-(--accent-red)">*</span>}
      </FieldLabel>
      <FieldContent>

      {question.type === 'text' && (question.multiline ? (
        <Textarea value={value} placeholder={question.placeholder || ''} onChange={(event) => onChange(event.target.value)} />
      ) : (
        <Input value={value} placeholder={question.placeholder || ''} onChange={(event) => onChange(event.target.value)} />
      ))}

      {question.type === 'select' && (
        <Select value={value} onValueChange={onChange}>
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
        <RadioGroup value={value} onValueChange={onChange} className="gap-2">
          {options.map((option) => (
            <ChoiceRow
              key={option.value}
              id={`${question.id}-${option.value}`}
              option={option}
              control={<RadioGroupItem id={`${question.id}-${option.value}`} value={option.value} className="mt-0.5" />}
            />
          ))}
          {question.allow_other && (
            <ChoiceRow
              id={`${question.id}-${OTHER_VALUE}`}
              option={{ label: t('userInputOther') }}
              control={<RadioGroupItem id={`${question.id}-${OTHER_VALUE}`} value={OTHER_VALUE} className="mt-0.5" />}
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
              control={<Checkbox
                id={`${question.id}-${option.value}`}
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
          autoFocus
          value={other}
          placeholder={t('userInputOtherPlaceholder')}
          onChange={(event) => onOtherChange(event.target.value)}
        />
      )}
      </FieldContent>
    </Field>
  );
}

export function UserInputDialog({ request, open, onRespond }) {
  const questions = useMemo(() => request?.questions || [], [request]);
  const [answers, setAnswers] = useState(() => initialAnswers(questions));
  const [otherAnswers, setOtherAnswers] = useState({});
  const [customResponseOpen, setCustomResponseOpen] = useState(false);
  const [customResponse, setCustomResponse] = useState('');
  const [submitting, setSubmitting] = useState(false);
  const submittingRef = useRef(false);

  useEffect(() => {
    if (!request?.id) return;
    setAnswers(initialAnswers(questions));
    setOtherAnswers({});
    setCustomResponseOpen(false);
    setCustomResponse('');
    submittingRef.current = false;
    setSubmitting(false);
  }, [request?.id, questions]);

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
    if (submittingRef.current) return;
    submittingRef.current = true;
    setSubmitting(true);
    onRespond(request.id, {
      status,
      answers: status === 'skipped' ? {} : normalizedAnswers(),
      ...response,
    });
  };

  return (
    <Dialog
      open={open}
      onOpenChange={(next) => {
        // Ignore programmatic close after Submit/Skip already submitted.
        if (!next && request?.id && !submittingRef.current) respond('skipped');
      }}
    >
      <DialogContent
        onEscapeKeyDown={(event) => {
          if (!customResponseOpen) return;
          event.preventDefault();
          setCustomResponseOpen(false);
        }}
        className="max-h-[86vh] grid-rows-[auto_minmax(0,1fr)_auto] overflow-hidden sm:max-w-xl"
      >
        <DialogHeader>
          <DialogTitle>{request.title || t('userInputTitle')}</DialogTitle>
          {request.description && <p className="pt-1 text-[13px] leading-5 text-(--text-secondary)">{request.description}</p>}
        </DialogHeader>
        <FieldGroup className="min-h-0 gap-5 overflow-y-auto py-1 pr-1">
          {questions.map((question) => (
            <QuestionField
              key={question.id}
              question={question}
              value={answers[question.id] ?? (question.type === 'checkbox' ? [] : '')}
              other={otherAnswers[question.id] || ''}
              onChange={(value) => setAnswers((current) => ({ ...current, [question.id]: value }))}
              onOtherChange={(value) => setOtherAnswers((current) => ({ ...current, [question.id]: value }))}
            />
          ))}
        </FieldGroup>
        <div className="flex flex-col gap-3">
          {customResponseOpen && (
            <div className="rounded-lg border border-(--border-default) bg-(--bg-secondary) p-3">
              <label htmlFor="user-input-custom-response" className="mb-2 block text-[12px] font-medium text-(--text-secondary)">
                {t('userInputCustomPrompt')}
              </label>
              <Textarea
                id="user-input-custom-response"
                autoFocus
                value={customResponse}
                placeholder={t('userInputCustomPlaceholder')}
                onChange={(event) => setCustomResponse(event.target.value)}
                className="min-h-20 bg-(--bg-primary)"
              />
            </div>
          )}
          <DialogFooter className="gap-2">
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
          </DialogFooter>
        </div>
      </DialogContent>
    </Dialog>
  );
}
