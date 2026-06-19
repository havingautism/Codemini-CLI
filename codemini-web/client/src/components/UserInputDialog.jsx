import { useEffect, useMemo, useState } from 'react';
import { Dialog, DialogContent, DialogFooter, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Textarea } from '@/components/ui/textarea';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
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

function ChoiceRow({ type, name, checked, onChange, option }) {
  return (
    <label className="flex cursor-pointer items-start gap-2.5 rounded-md border border-(--border-default) px-3 py-2 transition-colors hover:bg-(--bg-hover)">
      <input
        className="mt-0.5 size-4 shrink-0 accent-(--accent-blue)"
        type={type}
        name={name}
        checked={checked}
        onChange={onChange}
      />
      <OptionLabel option={option} />
    </label>
  );
}

function QuestionField({ question, value, other, onChange, onOtherChange }) {
  const options = Array.isArray(question.options) ? question.options : [];
  const showOther = question.allow_other && (
    question.type === 'checkbox' ? value.includes(OTHER_VALUE) : value === OTHER_VALUE
  );

  return (
    <div className="flex flex-col gap-2">
      <label className="text-[13px] font-medium leading-5 text-(--text-primary)">
        {question.label}
        {question.required && <span className="ml-1 text-(--accent-red)">*</span>}
      </label>

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
            {options.map((option) => (
              <SelectItem key={option.value} value={option.value}><OptionLabel option={option} /></SelectItem>
            ))}
            {question.allow_other && <SelectItem value={OTHER_VALUE}>{t('userInputOther')}</SelectItem>}
          </SelectContent>
        </Select>
      )}

      {question.type === 'radio' && (
        <div className="grid gap-2">
          {options.map((option) => (
            <ChoiceRow
              key={option.value}
              type="radio"
              name={question.id}
              option={option}
              checked={value === option.value}
              onChange={() => onChange(option.value)}
            />
          ))}
          {question.allow_other && (
            <ChoiceRow
              type="radio"
              name={question.id}
              option={{ label: t('userInputOther') }}
              checked={value === OTHER_VALUE}
              onChange={() => onChange(OTHER_VALUE)}
            />
          )}
        </div>
      )}

      {question.type === 'checkbox' && (
        <div className="grid gap-2">
          {[...options, ...(question.allow_other ? [{ label: t('userInputOther'), value: OTHER_VALUE }] : [])].map((option) => (
            <ChoiceRow
              key={option.value}
              type="checkbox"
              name={question.id}
              option={option}
              checked={value.includes(option.value)}
              onChange={() => onChange(
                value.includes(option.value)
                  ? value.filter((item) => item !== option.value)
                  : [...value, option.value],
              )}
            />
          ))}
        </div>
      )}

      {showOther && (
        <Input
          autoFocus
          value={other}
          placeholder={t('userInputOtherPlaceholder')}
          onChange={(event) => onOtherChange(event.target.value)}
        />
      )}
    </div>
  );
}

export function UserInputDialog({ request, open, onRespond }) {
  const questions = useMemo(() => request?.questions || [], [request]);
  const [answers, setAnswers] = useState(() => initialAnswers(questions));
  const [otherAnswers, setOtherAnswers] = useState({});

  useEffect(() => {
    setAnswers(initialAnswers(questions));
    setOtherAnswers({});
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

  const respond = (status) => onRespond(request.id, {
    status,
    answers: status === 'skipped' ? {} : normalizedAnswers(),
  });

  return (
    <Dialog open={open} onOpenChange={(next) => { if (!next) respond('skipped'); }}>
      <DialogContent className="max-h-[86vh] grid-rows-[auto_minmax(0,1fr)_auto] overflow-hidden sm:max-w-xl">
        <DialogHeader>
          <DialogTitle>{request.title || t('userInputTitle')}</DialogTitle>
          {request.description && <p className="pt-1 text-[13px] leading-5 text-(--text-secondary)">{request.description}</p>}
        </DialogHeader>
        <div className="min-h-0 space-y-5 overflow-y-auto py-1 pr-1">
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
        </div>
        <DialogFooter className="gap-2">
          <Button variant="outline" onClick={() => respond('skipped')}>{t('userInputSkip')}</Button>
          <Button disabled={missingRequired} onClick={() => respond('submitted')}>
            {request.submit_label || t('userInputSubmit')}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
