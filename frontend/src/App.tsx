import {
  ArrowUpRight, BookOpen, CalendarDays, Check, ChevronRight, Clock3, Droplets, Flower2,
  HeartPulse, History, Info, Leaf, LockKeyhole, LogIn, LogOut, Pencil, Plus, Settings,
  ShieldCheck, Sparkles, Trash2, X,
} from 'lucide-react'
import { useEffect, useRef, useState } from 'react'
import type { FormEvent, ReactNode } from 'react'
import { api, connect, dashboard, login, logout, register } from './api'
import { Calendar } from './Calendar'
import {
  asDate, demoDashboard, demoEstimate, formatDate, titleCase, today,
} from './calendar'
import type { Cycle, Dashboard, Prediction } from './calendar'

const source = 'https://www.asrm.org/practice-guidance/practice-committee-documents/optimizing-natural-fertility-a-committee-opinion-2021/'
const pages = [
  { id: 'calendar', name: 'Calendario', icon: CalendarDays, title: 'Tu calendario', description: 'Registra tu ciclo y consulta las estimaciones en un solo lugar.' },
  { id: 'history', name: 'Historial', icon: History, title: 'Tu historial', description: 'Consulta y edita las fechas que has registrado.' },
  { id: 'guide', name: 'Guía del ciclo', icon: BookOpen, title: 'Guía del ciclo', description: 'Cómo se calculan las fechas y cuándo consultar a un profesional.' },
  { id: 'settings', name: 'Configuración', icon: Settings, title: 'Configuración', description: 'Personaliza las estimaciones y gestiona tus datos.' },
] as const

type Page = typeof pages[number]['id']
type DialogView =
  | { type: 'record'; cycle?: Cycle }
  | { type: 'confirm'; action: 'cycle' | 'history' | 'account'; cycle?: Cycle }
  | { type: 'account' }

const emptyDashboard: Dashboard = {
  consented: false, cycles: [], usual_length: null, irregular: false,
  prediction: { status: 'insufficient' },
}
const predictionNotes: Record<Prediction['status'], string> = {
  estimated: 'Las fechas pueden variar de un ciclo a otro.',
  insufficient: 'Registra tres inicios de menstruación o indica una duración habitual para obtener una estimación.',
  irregular: 'Los ciclos variables dificultan estimar fechas con el calendario.',
  pending: 'Estamos recalculando tus fechas con los cambios recientes.',
  stale: 'La fecha estimada ya pasó. Registra tu menstruación cuando comience para actualizar el calendario.',
}

function shortDate(value: string) {
  return formatDate(value, { day: 'numeric', month: 'long' })
}

function formatWindow(start: string, end: string) {
  if (start.slice(0, 7) === end.slice(0, 7)) {
    return `Del ${asDate(start).getDate()} al ${shortDate(end)}`
  }
  return `Del ${shortDate(start)} al ${shortDate(end)}`
}

function Sidebar({
  page, changePage, authenticated, openAccount,
}: {
  page: Page
  changePage: (next: Page) => void
  authenticated: boolean
  openAccount: () => void
}) {
  return (
    <aside className="sidebar">
      <a className="brand" href="/" onClick={event => { event.preventDefault(); changePage('calendar') }}>
        <span className="brand-mark"><Flower2 size={23} strokeWidth={1.7} /></span>
        <span>Ritmo<small>Calendario menstrual</small></span>
      </a>
      <nav aria-label="Navegación principal" className="nav">
        {pages.map(item => <button
          key={item.id}
          className={page === item.id ? 'nav-link active' : 'nav-link'}
          onClick={() => changePage(item.id)}
          aria-current={page === item.id ? 'page' : undefined}
        ><item.icon size={19} strokeWidth={1.8} /><span>{item.name}</span></button>)}
      </nav>
      <div className="sidebar-bottom">
        <div className="side-note"><ShieldCheck size={18} /><span>{authenticated ? 'Historial privado' : 'Datos de ejemplo'}</span></div>
        <button className="profile-button" onClick={openAccount}>
          <span className="profile-icon">{authenticated ? <LockKeyhole size={17} /> : <LogIn size={17} />}</span>
          <span>{authenticated ? 'Mi cuenta' : 'Iniciar sesión'}<small>{authenticated ? 'Sesión activa' : 'Guarda tu historial'}</small></span>
          <ChevronRight className="profile-chevron" size={16} />
        </button>
      </div>
    </aside>
  )
}

function Hero({ data, demo }: { data: Dashboard; demo: boolean }) {
  const { prediction } = data
  const estimated = prediction.status === 'estimated'
  const fertileToday = estimated && prediction.fertile_from && prediction.fertile_to &&
    today >= prediction.fertile_from && today <= prediction.fertile_to
  const label = fertileToday ? 'Ventana fértil estimada' : estimated ? 'Resumen del ciclo' : 'Seguimiento del ciclo'
  let note = predictionNotes[prediction.status]
  if (estimated && prediction.ovulation) {
    note = prediction.ovulation === today
      ? 'Hoy coincide con el día de ovulación estimado.'
      : `Ovulación estimada para el ${shortDate(prediction.ovulation)}.`
  }
  if (!data.consented) note = 'Confirma el consentimiento para empezar a registrar tu ciclo.'

  return (
    <section className="hero" aria-label={label}>
      <div className="hero-content">
        <span className="hero-tag"><Sparkles size={14} />{label}</span>
        <h2>Tu ciclo, a tu ritmo.</h2>
        <p>{note}</p>
        {demo && <span className="hero-example">Visualización con fechas de ejemplo</span>}
      </div>
    </section>
  )
}

function Forecast({ prediction }: { prediction: Prediction }) {
  const { next_period, ovulation, fertile_from, fertile_to } = prediction
  return (
    <section className="card forecast" aria-labelledby="forecast-title">
      <div className="forecast-title">
        <span className="outline-icon"><Clock3 size={19} /></span>
        <div><h2 id="forecast-title">Próximas fechas</h2><p>Estimaciones de tu ciclo</p></div>
      </div>
      <div className="forecast-rows">
        <div className="forecast-row"><span className="row-icon period-icon"><Droplets size={20} /></span><div><span>Próxima menstruación</span><strong>{next_period ? shortDate(next_period) : 'Sin estimación'}</strong></div></div>
        <div className="forecast-row"><span className="row-icon fertile-icon"><Flower2 size={20} /></span><div><span>Ventana fértil</span><strong>{fertile_from && fertile_to ? formatWindow(fertile_from, fertile_to) : 'Sin estimación'}</strong></div></div>
        <div className="forecast-row"><span className="row-icon ovulation-icon"><Sparkles size={20} /></span><div><span>Ovulación</span><strong>{ovulation ? shortDate(ovulation) : 'Sin estimación'}</strong></div></div>
      </div>
      <div className="forecast-foot" aria-live="polite"><Info size={16} /><p>
        {prediction.basis === 'declared'
          ? 'Estimación basada en la duración que indicaste. Añade más ciclos para usar tu historial.'
          : predictionNotes[prediction.status]}
      </p></div>
    </section>
  )
}

function Advisory({ openGuide }: { openGuide: () => void }) {
  return (
    <section className="card advisory">
      <div className="advisory-icon"><HeartPulse size={19} /></div>
      <div>
        <h2>Sobre estas estimaciones</h2>
        <p>El calendario no diagnostica la fertilidad ni sirve como anticonceptivo.</p>
        <button className="text-button" onClick={openGuide}>Entender mi ciclo <ChevronRight size={16} /></button>
      </div>
    </section>
  )
}

function HistoryPanel({ cycles, edit, remove, compact, onHistory }: {
  cycles: Cycle[]
  edit: (cycle: Cycle) => void
  remove: (cycle: Cycle) => void
  compact?: boolean
  onHistory?: () => void
}) {
  const ordered = [...cycles].sort((a, b) => b.start_date.localeCompare(a.start_date))
  const visible = compact ? ordered.slice(0, 3) : ordered
  return (
    <section className={'card history-card' + (compact ? ' compact-history' : '')}>
      <div className="section-heading">
        <div><h2>{compact ? 'Registros recientes' : 'Menstruaciones registradas'}</h2><p>Primer día de cada menstruación.</p></div>
        {onHistory && <button className="text-button" onClick={onHistory}>Ver historial <ChevronRight size={17} /></button>}
      </div>
      {visible.length === 0 ? <div className="empty"><Droplets size={22} /><p>Todavía no hay fechas registradas.</p></div> : (
        <ul className="history-list">
          {visible.map(cycle => <li key={cycle.id}>
            <span className="row-icon period-icon"><Droplets size={18} /></span>
            <strong>{titleCase(formatDate(cycle.start_date, { dateStyle: 'long' }))}</strong>
            <div className="history-actions">
              <button className="button button-subtle icon-button" aria-label={`Editar ${shortDate(cycle.start_date)}`} onClick={() => edit(cycle)}><Pencil size={16} /></button>
              <button className="button button-subtle icon-button delete-icon" aria-label={`Eliminar ${shortDate(cycle.start_date)}`} onClick={() => remove(cycle)}><Trash2 size={16} /></button>
            </div>
          </li>)}
        </ul>
      )}
    </section>
  )
}

function Guide() {
  return (
    <div className="guide-grid">
      <article className="card guide-card">
        <span className="row-icon period-icon"><Droplets size={22} /></span>
        <h2>Cómo registrar tu ciclo</h2>
        <p>El día 1 es el primer día de la menstruación. La duración del ciclo se cuenta desde esa fecha hasta el inicio de la siguiente menstruación.</p>
      </article>
      <article className="card guide-card">
        <span className="row-icon fertile-icon"><Flower2 size={22} /></span>
        <h2>Cómo leer la ventana fértil</h2>
        <p>La ventana fértil abarca los cinco días anteriores a la ovulación y el día de la ovulación. La fecha puede variar incluso en ciclos regulares.</p>
      </article>
      <article className="card guide-card">
        <span className="row-icon ovulation-icon"><Sparkles size={22} /></span>
        <h2>Qué significa una estimación</h2>
        <p>Ritmo usa la duración indicada o los intervalos registrados. Si los ciclos son variables o faltan datos, el calendario omite las fechas estimadas. Esta herramienta no mide hormonas, no diagnostica la fertilidad y no sirve como anticonceptivo.</p>
      </article>
      <article className="card guide-card">
        <span className="row-icon fertile-icon"><HeartPulse size={22} /></span>
        <h2>Cuándo consultar</h2>
        <p>Consulta antes si tus ciclos suelen ser irregulares o falta la menstruación. Si buscas un embarazo, considera una evaluación tras 12 meses de intentos si tienes menos de 35 años, o tras 6 meses si tienes 35 años o más.</p>
      </article>
      <a className="text-button source-link" href={source} target="_blank" rel="noreferrer">Fuente clínica de la ASRM <ArrowUpRight size={16} /></a>
    </div>
  )
}

function Modal({ title, intro, children, close, disableClose }: {
  title: string
  intro?: string
  children: ReactNode
  close: () => void
  disableClose: boolean
}) {
  const ref = useRef<HTMLDialogElement>(null)
  useEffect(() => {
    ref.current?.showModal()
  }, [])
  return (
    <dialog className="dialog" ref={ref} aria-labelledby="dialog-title" onCancel={event => {
      event.preventDefault()
      if (!disableClose) close()
    }}>
      <div className="dialog-inner">
        <button className="button button-subtle icon-button close-button" aria-label="Cerrar" onClick={close} disabled={disableClose}><X size={20} /></button>
        <h2 id="dialog-title">{title}</h2>
        {intro && <p>{intro}</p>}
        {children}
      </div>
    </dialog>
  )
}

function CycleSettings({ data, onSave, busy }: {
  data: Dashboard
  onSave: (length: number | null, irregular: boolean) => void
  busy: boolean
}) {
  const [length, setLength] = useState(data.usual_length?.toString() ?? '')
  const [irregular, setIrregular] = useState(data.irregular)
  function submit(event: FormEvent) {
    event.preventDefault()
    onSave(length ? Number(length) : null, irregular)
  }
  return (
    <form className="card settings-card" onSubmit={submit}>
      <h2>Duración habitual del ciclo</h2>
      <p>Si registras al menos tres inicios, usamos el historial para calcular la duración.</p>
      <label htmlFor="usual-length">Duración en días (opcional)</label>
      <input id="usual-length" type="number" inputMode="numeric" min={15} max={90} placeholder="Por ejemplo, 28" value={length} onChange={event => setLength(event.target.value)} />
      <label className="check-row"><input type="checkbox" checked={irregular} onChange={event => setIrregular(event.target.checked)} /> Mis ciclos suelen ser irregulares</label>
      <button className="button button-primary" type="submit" disabled={busy}>Guardar cambios</button>
    </form>
  )
}

export function App() {
  const [page, setPage] = useState<Page>('calendar')
  const [data, setData] = useState<Dashboard>(demoDashboard)
  const [month, setMonth] = useState(asDate(today))
  const [selected, setSelected] = useState(today)
  const [dialog, setDialog] = useState<DialogView | null>(null)
  const [recordDate, setRecordDate] = useState(today)
  const [recordLength, setRecordLength] = useState('')
  const [approved, setApproved] = useState(false)
  const [authenticated, setAuthenticated] = useState(false)
  const [identityAvailable, setIdentityAvailable] = useState<boolean | null>(null)
  const [busy, setBusy] = useState(false)
  const [notice, setNotice] = useState('')
  const [error, setError] = useState('')
  const [dialogError, setDialogError] = useState('')
  const main = useRef<HTMLElement>(null)
  const currentPage = pages.find(item => item.id === page)!

  useEffect(() => {
    let active = true
    connect().then(async result => {
      if (!active) return
      setIdentityAvailable(result.available)
      if (!result.authenticated) return
      setAuthenticated(true)
      setData(emptyDashboard)
      try {
        const result = await dashboard()
        if (active) setData(result)
      } catch {
        if (active) setError('No pudimos consultar tu historial. Actualiza la página para volver a intentarlo.')
      }
    })
    return () => { active = false }
  }, [])

  useEffect(() => {
    if (!authenticated || data.prediction.status !== 'pending') return
    let active = true
    const timer = window.setInterval(async () => {
      try {
        const result = await dashboard()
        if (active && result.prediction.status !== 'pending') setData(result)
      } catch {
        // The next poll can recover a temporary loss of connection.
      }
    }, 1800)
    return () => { active = false; window.clearInterval(timer) }
  }, [authenticated, data.prediction.status])

  function changePage(next: Page) {
    setPage(next)
    setError('')
    if (page !== next) {
      window.scrollTo({ top: 0 })
      main.current?.focus({ preventScroll: true })
    }
  }

  function showDialog(next: DialogView) {
    setDialogError('')
    setDialog(next)
  }

  function startRecord(cycle?: Cycle, key = today) {
    if (!data.consented) {
      document.getElementById('consent-checkbox')?.focus()
      return
    }
    setRecordDate(cycle?.start_date ?? key)
    setRecordLength(data.usual_length?.toString() ?? '')
    showDialog({ type: 'record', cycle })
  }

  async function perform(action: () => Promise<void> | void, message: string, inDialog = false) {
    setBusy(true)
    setNotice('')
    setError('')
    setDialogError('')
    try {
      await action()
      if (inDialog) setDialog(null)
      setNotice(message)
    } catch (reason) {
      const text = reason instanceof Error ? reason.message : 'Inténtalo de nuevo.'
      if (inDialog) setDialogError(text)
      else setError(text)
    } finally {
      setBusy(false)
    }
  }

  function applyDemo(cycles: Cycle[], length = data.usual_length, irregular = data.irregular) {
    setData({
      consented: true, cycles, usual_length: length, irregular,
      prediction: demoEstimate(cycles, length, irregular),
    })
  }

  async function submitRecord(event: FormEvent) {
    event.preventDefault()
    if (dialog?.type !== 'record') return
    const cycle = dialog.cycle
    const length = recordLength ? Number(recordLength) : null
    await perform(async () => {
      if (data.cycles.some(item => item.start_date === recordDate && item.id !== cycle?.id)) {
        throw new Error('Ya registraste esa fecha.')
      }
      if (authenticated) {
        const payload = cycle ? { start_date: recordDate } : { start_date: recordDate, usual_length: length }
        await api(cycle ? '/cycles/' + cycle.id : '/cycles', cycle ? 'PUT' : 'POST', payload)
        await refreshSavedData()
      } else {
        const updated = { id: cycle?.id ?? crypto.randomUUID(), start_date: recordDate }
        applyDemo([...data.cycles.filter(item => item.id !== updated.id), updated], cycle ? data.usual_length : length)
      }
      setSelected(recordDate)
      setMonth(asDate(recordDate))
    }, cycle ? 'Registro actualizado.' : 'Menstruación registrada.', true)
  }

  async function confirmDeletion() {
    if (dialog?.type !== 'confirm') return
    const { action, cycle } = dialog
    await perform(async () => {
      if (action === 'account') {
        await api('/account', 'DELETE')
        setAuthenticated(false)
        setApproved(false)
        setPage('calendar')
        setData(demoDashboard())
        await logout()
      } else if (authenticated) {
        await api(action === 'history' ? '/history' : '/cycles/' + cycle?.id, 'DELETE')
        await refreshSavedData()
      } else if (action === 'history') {
        applyDemo([], null, false)
      } else {
        applyDemo(data.cycles.filter(item => item.id !== cycle?.id))
      }
    }, action === 'account' ? 'Se solicitó eliminar tu cuenta.' : 'Datos eliminados.', true)
  }

  async function refreshSavedData() {
    try {
      setData(await dashboard())
    } catch {
      setError('El cambio quedó guardado. Recarga la página para ver los datos actualizados.')
    }
  }

  const confirmText = dialog?.type === 'confirm' ? {
    cycle: ['¿Eliminar este registro?', 'Se eliminará la fecha y se actualizarán las estimaciones.'],
    history: ['¿Borrar el historial?', 'Se eliminarán los registros, las estimaciones y la duración guardada.'],
    account: ['¿Eliminar tu cuenta?', 'Se eliminarán tu historial y tu cuenta. La sesión se cerrará al confirmar.'],
  }[dialog.action] : null

  return (
    <div className="app-shell">
      <a className="skip-link" href="#main">Ir al contenido</a>
      <Sidebar page={page} changePage={changePage} authenticated={authenticated} openAccount={() => showDialog({ type: 'account' })} />
      <main id="main" ref={main} tabIndex={-1} className="main">
        <header className="page-header">
          <div>
            <div className="date-label"><CalendarDays size={16} />{titleCase(formatDate(today, { weekday: 'long', day: 'numeric', month: 'long' }))}</div>
            <h1>{currentPage.title}</h1>
            <p>{currentPage.description}</p>
          </div>
          <div className="header-actions">
            {!authenticated && <span className="demo-badge"><span />Modo demo</span>}
            {(page === 'calendar' || page === 'history') && <button className="button button-primary" onClick={() => startRecord()}><Plus size={19} /> Registrar menstruación</button>}
          </div>
        </header>

        {notice && <div role="status" className="message success"><Check size={17} />{notice}<button aria-label="Cerrar aviso" onClick={() => setNotice('')}><X size={15} /></button></div>}
        {error && <div role="alert" className="message error"><Info size={17} />{error}<button aria-label="Cerrar aviso" onClick={() => setError('')}><X size={15} /></button></div>}
        {authenticated && !data.consented && (
          <section className="card consent">
            <span className="row-icon fertile-icon"><ShieldCheck size={20} /></span>
            <div>
              <h2>Consentimiento para registrar ciclos</h2>
              <p>Usaremos las fechas para mostrar tu historial y calcular estimaciones. Puedes borrar los datos desde Configuración.</p>
              <label className="check-row"><input id="consent-checkbox" type="checkbox" checked={approved} onChange={event => setApproved(event.target.checked)} />Confirmo que son mis datos o que la persona me dio permiso para registrarlos.</label>
              <button className="button button-primary" disabled={!approved || busy} onClick={() => perform(async () => {
                await api('/consent', 'POST', { accepted: true })
                setData(await dashboard())
              }, 'Consentimiento guardado.')}>Confirmar consentimiento</button>
            </div>
          </section>
        )}

        {page === 'calendar' && <>
          <Hero data={data} demo={!authenticated} />
          <div className="dashboard-grid">
            <Calendar data={data} month={month} selected={selected} onMonth={(year, value) => setMonth(new Date(year, value, 1, 12))} onSelect={setSelected} onAdd={() => startRecord(undefined, selected)} />
            <div className="summary">
              <Forecast prediction={data.prediction} />
              <Advisory openGuide={() => changePage('guide')} />
            </div>
          </div>
          <HistoryPanel cycles={data.cycles} edit={startRecord} remove={cycle => showDialog({ type: 'confirm', action: 'cycle', cycle })} compact onHistory={() => changePage('history')} />
        </>}
        {page === 'history' && <HistoryPanel cycles={data.cycles} edit={startRecord} remove={cycle => showDialog({ type: 'confirm', action: 'cycle', cycle })} />}
        {page === 'guide' && <Guide />}
        {page === 'settings' && <div className="settings-grid">
          {data.consented && <CycleSettings key={String(data.usual_length) + data.irregular} data={data} busy={busy} onSave={(length, irregular) =>
            perform(async () => {
              if (authenticated) {
                await api('/preferences', 'PUT', { usual_length: length, irregular })
                await refreshSavedData()
              } else applyDemo(data.cycles, length, irregular)
            }, 'Preferencias guardadas.')} />}
          <section className="card settings-card privacy">
            <h2>Datos y privacidad</h2>
            <p>{authenticated ? 'Controla los datos vinculados a tu cuenta.' : 'En la demo los cambios se pierden al recargar.'}</p>
            {data.consented && <button className="button button-danger-subtle" onClick={() => showDialog({ type: 'confirm', action: 'history' })}><Trash2 size={17} /> Borrar historial</button>}
            {authenticated && <button className="button button-danger-subtle" onClick={() => showDialog({ type: 'confirm', action: 'account' })}><Trash2 size={17} /> Eliminar cuenta</button>}
            {!authenticated && <button className="button button-subtle" onClick={() => showDialog({ type: 'account' })}><LogIn size={17} /> Inicio de sesión</button>}
          </section>
        </div>}

        <footer className="footer"><Leaf size={15} /> Ritmo · Proyecto académico de seguimiento menstrual</footer>
      </main>

      {dialog?.type === 'record' && <Modal title={dialog.cycle ? 'Editar registro' : 'Registrar menstruación'}
        intro={authenticated ? 'Selecciona el primer día de la menstruación.' : 'Usa fechas ficticias para probar el calendario.'}
        close={() => setDialog(null)} disableClose={busy}>
        <form onSubmit={submitRecord} className="dialog-form">
          <label htmlFor="start-date">Primer día de la menstruación</label>
          <input id="start-date" type="date" max={today} min="1900-01-01" value={recordDate} onChange={event => setRecordDate(event.target.value)} required autoFocus />
          {!dialog.cycle && <>
            <label htmlFor="record-length">Duración habitual del ciclo (opcional)</label>
            <input id="record-length" type="number" min={15} max={90} placeholder="Por ejemplo, 28" value={recordLength} onChange={event => setRecordLength(event.target.value)} />
          </>}
          {dialogError && <p role="alert" className="dialog-error">{dialogError}</p>}
          <div className="dialog-actions">
            <button className="button button-subtle" type="button" onClick={() => setDialog(null)} disabled={busy}>Cancelar</button>
            <button className="button button-primary" type="submit" disabled={busy}>{busy ? 'Guardando…' : 'Guardar'}</button>
          </div>
        </form>
      </Modal>}
      {confirmText && <Modal title={confirmText[0]} intro={confirmText[1]} close={() => setDialog(null)} disableClose={busy}>
        {dialogError && <p role="alert" className="dialog-error">{dialogError}</p>}
        <div className="dialog-actions">
          <button className="button button-subtle" onClick={() => setDialog(null)} disabled={busy} autoFocus>Cancelar</button>
          <button className="button button-danger" onClick={confirmDeletion} disabled={busy}>{busy ? 'Eliminando…' : 'Eliminar'}</button>
        </div>
      </Modal>}
      {dialog?.type === 'account' && <Modal title={authenticated ? 'Mi cuenta' : 'Guarda tu historial'}
        intro={authenticated ? 'Tu sesión está activa.' : 'Crea una cuenta o inicia sesión en el entorno del proyecto.'}
        close={() => setDialog(null)} disableClose={busy}>
        {identityAvailable === false && <p className="dialog-error">El servicio de identidad no está disponible en esta vista. Puedes seguir explorando la demo.</p>}
        {dialogError && <p role="alert" className="dialog-error">{dialogError}</p>}
        <div className="dialog-actions">
          {authenticated ? <button className="button button-primary" onClick={() => perform(logout, '', true)} disabled={busy}><LogOut size={17} /> Cerrar sesión</button> : <>
            <button className="button button-subtle" disabled={!identityAvailable || busy} onClick={() => perform(register, '', true)}>Crear cuenta</button>
            <button className="button button-primary" disabled={!identityAvailable || busy} onClick={() => perform(login, '', true)}>Iniciar sesión</button>
          </>}
        </div>
      </Modal>}
    </div>
  )
}
