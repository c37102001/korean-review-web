import { useEffect, useState } from 'react'
import { useAuth } from '../../contexts/AuthContext.jsx'
import { fetchDaysInRange } from '../../lib/firestoreApi.js'
import { toDateString, todayString } from '../../lib/dateUtils.js'
import DayDetailModal from './DayDetailModal.jsx'

const WEEKDAYS = ['日', '一', '二', '三', '四', '五', '六']

function buildMonthGrid(year, month) {
  const firstOfMonth = new Date(year, month, 1)
  const startWeekday = firstOfMonth.getDay()
  const daysInMonth = new Date(year, month + 1, 0).getDate()

  const cells = []
  for (let i = 0; i < startWeekday; i += 1) cells.push(null)
  for (let d = 1; d <= daysInMonth; d += 1) cells.push(new Date(year, month, d))
  return cells
}

export default function CalendarView() {
  const { user } = useAuth()
  const now = new Date()
  const [year, setYear] = useState(now.getFullYear())
  const [month, setMonth] = useState(now.getMonth()) // 0-indexed
  const [daysWithData, setDaysWithData] = useState({})
  const [selectedDate, setSelectedDate] = useState(null)

  useEffect(() => {
    const start = toDateString(new Date(year, month, 1))
    const end = toDateString(new Date(year, month + 1, 0))
    fetchDaysInRange(user.uid, start, end).then(setDaysWithData)
  }, [user.uid, year, month])

  function changeMonth(delta) {
    let newMonth = month + delta
    let newYear = year
    if (newMonth < 0) {
      newMonth = 11
      newYear -= 1
    } else if (newMonth > 11) {
      newMonth = 0
      newYear += 1
    }
    setMonth(newMonth)
    setYear(newYear)
  }

  const cells = buildMonthGrid(year, month)
  const today = todayString()

  return (
    <div className="calendar-view">
      <div className="calendar-header">
        <button onClick={() => changeMonth(-1)}>‹</button>
        <h2>
          {year} 年 {month + 1} 月
        </h2>
        <button onClick={() => changeMonth(1)}>›</button>
      </div>

      <div className="calendar-grid calendar-weekdays">
        {WEEKDAYS.map((w) => (
          <div key={w} className="calendar-weekday">
            {w}
          </div>
        ))}
      </div>

      <div className="calendar-grid">
        {cells.map((date, i) => {
          if (!date) return <div key={i} className="calendar-cell calendar-cell-empty" />
          const dateString = toDateString(date)
          const hasData = Boolean(daysWithData[dateString])
          const isToday = dateString === today
          return (
            <button
              key={i}
              className={`calendar-cell${hasData ? ' has-data' : ''}${isToday ? ' is-today' : ''}`}
              onClick={() => setSelectedDate(dateString)}
            >
              <span>{date.getDate()}</span>
              {hasData && <span className="calendar-dot" />}
            </button>
          )
        })}
      </div>

      {selectedDate && <DayDetailModal date={selectedDate} onClose={() => setSelectedDate(null)} />}
    </div>
  )
}
