import {
  CalendarDays, ChevronLeft, ChevronRight, Droplets, Flower2, Plus, Sparkles,
} from 'lucide-react'
import { addDays, asDate, dateKey, formatDate, titleCase, today } from './calendar'
import type { Dashboard } from './calendar'

export type DayKind = 'record' | 'next' | 'fertile' | 'ovulation' | ''

export function dayKind(key: string, data: Dashboard): DayKind {
  if (data.cycles.some(cycle => cycle.start_date === key)) return 'record'
  const prediction = data.prediction
  if (prediction.status !== 'estimated') return ''
  if (key === prediction.next_period) return 'next'
  if (key === prediction.ovulation) return 'ovulation'
  if (prediction.fertile_from && prediction.fertile_to && key >= prediction.fertile_from && key <= prediction.fertile_to) {
    return 'fertile'
  }
  return ''
}

const descriptions: Record<DayKind, string> = {
  record: 'Menstruación registrada',
  next: 'Próxima menstruación estimada',
  fertile: 'Ventana fértil estimada',
  ovulation: 'Ovulación estimada',
  '': 'Sin eventos',
}

export function Calendar({
  data, month, selected, onMonth, onSelect, onAdd,
}: {
  data: Dashboard
  month: Date
  selected: string
  onMonth: (year: number, month: number) => void
  onSelect: (key: string) => void
  onAdd: () => void
}) {
  const first = new Date(month.getFullYear(), month.getMonth(), 1, 12)
  const firstVisible = addDays(first, -((first.getDay() + 6) % 7))
  const dates = Array.from({ length: 42 }, (_, index) => addDays(firstVisible, index))
  const current = asDate(today)
  const selectedKind = dayKind(selected, data)

  return (
    <section className="card calendar-card" aria-labelledby="calendar-title">
      <div className="calendar-head">
        <div>
          <h2 id="calendar-title">{titleCase(formatDate(dateKey(month), { month: 'long', year: 'numeric' }))}</h2>
          <p>Selecciona un día para ver sus detalles.</p>
        </div>
        <div className="calendar-actions">
          <button className="button button-subtle today-button" onClick={() => {
            onMonth(current.getFullYear(), current.getMonth())
            onSelect(today)
          }}>Hoy</button>
          <button className="button button-subtle icon-button" aria-label="Mes anterior" onClick={() => onMonth(month.getFullYear(), month.getMonth() - 1)}><ChevronLeft size={19} /></button>
          <button className="button button-subtle icon-button" aria-label="Mes siguiente" onClick={() => onMonth(month.getFullYear(), month.getMonth() + 1)}><ChevronRight size={19} /></button>
        </div>
      </div>
      <div className="calendar-grid" aria-label="Calendario mensual">
        {['Lun', 'Mar', 'Mié', 'Jue', 'Vie', 'Sáb', 'Dom'].map(day => <div className="week-day" key={day}>{day}</div>)}
        {dates.map(day => {
          const key = dateKey(day)
          const kind = dayKind(key, data)
          const outside = day.getMonth() !== month.getMonth()
          return (
            <button key={key}
              className={['calendar-day', outside ? 'outside' : '', selected === key ? 'selected' : '', kind].join(' ')}
              aria-label={formatDate(key, { dateStyle: 'full' }) + ', ' + descriptions[kind]}
              aria-current={key === today ? 'date' : undefined}
              aria-pressed={key === selected}
              onClick={() => onSelect(key)}
            >
              <span className="day-content">
                {day.getDate()}
                {kind === 'record' && <span className="day-dot" aria-hidden="true" />}
                {kind === 'ovulation' && <Sparkles size={12} aria-hidden="true" />}
                {kind === 'next' && <span className="day-dot" aria-hidden="true" />}
              </span>
            </button>
          )
        })}
      </div>
      <div className="legend" aria-label="Leyenda">
        <span><i className="legend-record" /> Menstruación</span>
        <span><i className="legend-fertile" /> Ventana fértil estimada</span>
        <span><i className="legend-ovulation" /> Ovulación estimada</span>
      </div>
      <div className="selected-day" aria-live="polite">
        <div className={'selected-icon ' + (selectedKind || 'neutral')}>
          {selectedKind === 'ovulation' ? <Sparkles size={17} /> : selectedKind === 'fertile' ? <Flower2 size={17} /> : selectedKind ? <Droplets size={17} /> : <CalendarDays size={17} />}
        </div>
        <div>
          <strong>{titleCase(formatDate(selected, { weekday: 'long', day: 'numeric', month: 'long' }))}</strong>
          <small>{descriptions[selectedKind]}</small>
        </div>
        {!selectedKind && selected <= today && <button className="button button-subtle icon-button selected-add" aria-label="Registrar la fecha seleccionada" onClick={onAdd}><Plus size={17} /></button>}
      </div>
    </section>
  )
}
