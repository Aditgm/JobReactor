import React, { useState, useEffect, useRef } from 'react';
import './index.css';

// Har job type ke liye default processing duration (ticks)
const JOB_DURATIONS = {
  'email:send': 3,
  'image:resize': 5,
  'heavy:task': 8,
  'failing:task': 4,
};

function App() {
  // Connection aur simulation states
  const [isSimulation, setIsSimulation] = useState(false);
  const [connectionError, setConnectionError] = useState(false);
  
  // Real metrics status (API se aane waale)
  const [metrics, setMetrics] = useState({
    waitingDepth: 0,
    activeCount: 0,
    dlqSize: 0,
    completedToday: 0,
    throughputPerMin: 0,
    workerHealth: { active: 0, idle: 8, total: 8 },
    redisMemoryMB: '0.00M',
  });

  // Simulated metrics data
  const [simWaiting, setSimWaiting] = useState([]);
  const [simDelayed, setSimDelayed] = useState([]);
  const [simActive, setSimActive] = useState([]);
  const [simCompletedCount, setSimCompletedCount] = useState(128); // Base value taaki authentic lage
  const [simDlqCount, setSimDlqCount] = useState(2);
  const [simThroughput, setSimThroughput] = useState(48);
  const [simWorkers, setSimWorkers] = useState(
    Array.from({ length: 8 }, (_, i) => ({ id: `worker-${i}`, status: 'idle', jobId: null, jobName: null, progress: 0 }))
  );
  
  // Terminal activity logs
  const [logs, setLogs] = useState([
    { text: 'System initialized. Redis connection standby.', type: 'info', id: 1 },
    { text: 'Mock Simulation engine ready.', type: 'warn', id: 2 }
  ]);

  // Form inputs
  const [jobType, setJobType] = useState('email:send');
  const [priority, setPriority] = useState(5);
  const [delay, setDelay] = useState(0);

  const logIdRef = useRef(3);
  const addLog = (text, type = 'info') => {
    setLogs(prev => [
      { text: `[${new Date().toLocaleTimeString()}] ${text}`, type, id: logIdRef.current++ },
      ...prev.slice(0, 49) // Max 50 logs save rakhenge
    ]);
  };

  // API metrics check karne ke liye hook
  useEffect(() => {
    let interval;
    const fetchMetrics = async () => {
      // Agar active simulation hai, toh API calls ignore karo
      if (isSimulation) return;

      try {
        const url = import.meta.env.VITE_API_URL || 'http://localhost:3000/api';
        const res = await fetch(`${url}/metrics`);
        if (!res.ok) throw new Error('API server unreachable');
        const data = await res.json();
        setMetrics(data);
        setConnectionError(false);
      } catch (err) {
        console.warn('API is offline, switching to interactive simulation mode.');
        setConnectionError(true);
        setIsSimulation(true); // Auto simulation toggle
        addLog('Local backend server offline. Simulation mode auto-activated.', 'warn');
      }
    };

    fetchMetrics();
    interval = setInterval(fetchMetrics, 2000);
    return () => clearInterval(interval);
  }, [isSimulation]);

  // Client-side simulation loop
  useEffect(() => {
    if (!isSimulation) return;

    const interval = setInterval(() => {
      const now = Date.now();

      // 1. Delayed jobs ko check karo aur waiting queue mein daalo
      setSimDelayed(prevDelayed => {
        const ready = prevDelayed.filter(j => j.runAt <= now);
        if (ready.length > 0) {
          ready.forEach(j => addLog(`Job ${j.id.slice(0, 8)} (${j.name}) promoted from Delayed to Waiting`, 'info'));
          setSimWaiting(prevWaiting => {
            const updated = [...prevWaiting, ...ready.map(r => ({ ...r, status: 'waiting' }))];
            // Priority order (lowest score is processed first)
            return updated.sort((a, b) => a.priority - b.priority || a.createdAt - b.createdAt);
          });
        }
        return prevDelayed.filter(j => j.runAt > now);
      });

      // 2. Idle workers ko new jobs assign karo
      setSimWorkers(prevWorkers => {
        let waitingBuffer = [];
        setSimWaiting(prevWaiting => {
          waitingBuffer = [...prevWaiting];
          return prevWaiting;
        });

        const updatedWorkers = prevWorkers.map(worker => {
          if (worker.status === 'idle' && waitingBuffer.length > 0) {
            const nextJob = waitingBuffer.shift(); // Priority queue head pop karo
            
            addLog(`Worker ${worker.id} locked job ${nextJob.id.slice(0, 8)} [${nextJob.name}]`, 'info');
            
            // Waiting set ko update karo state mein
            setSimWaiting(waitingBuffer);

            setSimActive(prevActive => [...prevActive, {
              ...nextJob,
              workerId: worker.id,
              progress: 0,
              duration: JOB_DURATIONS[nextJob.name] || 4,
              maxDuration: JOB_DURATIONS[nextJob.name] || 4,
            }]);

            return {
              ...worker,
              status: 'working',
              jobId: nextJob.id,
              jobName: nextJob.name,
              progress: 0
            };
          }
          return worker;
        });

        return updatedWorkers;
      });

      // 3. Active jobs ka progress increment karo
      setSimActive(prevActive => {
        const completedJobs = [];
        const retryingJobs = [];
        const dlqJobs = [];

        const updatedActive = prevActive.map(job => {
          const nextProgress = job.progress + (100 / job.duration);
          
          if (nextProgress >= 100) {
            if (job.name === 'failing:task') {
              const currentAttempts = (job.attempts || 0) + 1;
              if (currentAttempts >= (job.maxAttempts || 3)) {
                dlqJobs.push({ ...job, status: 'dlq' });
              } else {
                retryingJobs.push({ 
                  ...job, 
                  attempts: currentAttempts, 
                  runAt: Date.now() + 4000 // 4 seconds delay backoff
                });
              }
            } else {
              completedJobs.push(job);
            }
            return null; // Job active se hat gaya hai
          }
          
          return { ...job, progress: Math.min(nextProgress, 99) };
        }).filter(Boolean);

        // Workers check karke idle state set karo
        if (completedJobs.length > 0 || retryingJobs.length > 0 || dlqJobs.length > 0) {
          const finishedIds = [...completedJobs, ...retryingJobs, ...dlqJobs].map(j => j.id);
          
          setSimWorkers(prevWorkers => prevWorkers.map(w => {
            if (finishedIds.includes(w.jobId)) {
              return { ...w, status: 'idle', jobId: null, jobName: null, progress: 0 };
            }
            return w;
          }));
        }

        // State statistics increments
        if (completedJobs.length > 0) {
          completedJobs.forEach(j => addLog(`Job ${j.id.slice(0, 8)} successfully finished by worker`, 'complete'));
          setSimCompletedCount(c => c + completedJobs.length);
        }

        if (retryingJobs.length > 0) {
          retryingJobs.forEach(j => addLog(`Job ${j.id.slice(0, 8)} failed, retrying in 4s (Attempts: ${j.attempts}/${j.maxAttempts})`, 'warn'));
          setSimDelayed(prev => [...prev, ...retryingJobs]);
        }

        if (dlqJobs.length > 0) {
          dlqJobs.forEach(j => addLog(`Job ${j.id.slice(0, 8)} failed max attempts. Sent to DLQ!`, 'fail'));
          setSimDlqCount(c => c + dlqJobs.length);
        }

        return updatedActive;
      });

      // Active workers progress synchronization on state
      setSimWorkers(prevWorkers => {
        setSimActive(prevActive => {
          return prevActive;
        });
        return prevWorkers.map(w => {
          if (w.status === 'working') {
            let matchedJob;
            setSimActive(active => {
              matchedJob = active.find(j => j.id === w.jobId);
              return active;
            });
            if (matchedJob) {
              return { ...w, progress: matchedJob.progress };
            }
          }
          return w;
        });
      });

      // Throughput dynamic fluctuation
      setSimThroughput(prev => {
        const delta = Math.floor(Math.random() * 5) - 2;
        return Math.max(20, Math.min(prev + delta, 90));
      });

    }, 1000);

    return () => clearInterval(interval);
  }, [isSimulation]);

  // Virtual environment mein job submit karne ke liye function
  const handleEnqueue = (e) => {
    e.preventDefault();

    const jobId = Math.random().toString(36).substring(2, 15);
    const newJob = {
      id: jobId,
      name: jobType,
      priority: parseInt(priority, 10),
      delay: parseInt(delay, 10) * 1000,
      createdAt: Date.now(),
      attempts: 0,
      maxAttempts: 3,
      status: delay > 0 ? 'delayed' : 'waiting',
    };

    if (isSimulation) {
      if (newJob.delay > 0) {
        newJob.runAt = Date.now() + newJob.delay;
        setSimDelayed(prev => [...prev, newJob]);
        addLog(`Mock job enqueued: ${jobType} (Delayed by ${delay}s)`, 'info');
      } else {
        setSimWaiting(prev => {
          const updated = [...prev, newJob];
          return updated.sort((a, b) => a.priority - b.priority || a.createdAt - b.createdAt);
        });
        addLog(`Mock job enqueued: ${jobType} (Priority: ${priority})`, 'info');
      }
    } else {
      // Live server par post karo
      const url = import.meta.env.VITE_API_URL || 'http://localhost:3000/api';
      fetch(`${url}/enqueue`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ name: jobType, data: { mock: true }, opts: { priority, delay: delay * 1000 } }),
      })
        .then(res => res.json())
        .then(data => {
          if (data.success) {
            addLog(`Server job enqueued: ${data.jobId.slice(0, 8)}`, 'complete');
          }
        })
        .catch(err => {
          addLog(`Server API submit error: ${err.message}`, 'fail');
        });
    }
  };

  // State elements selection
  const displayMetrics = isSimulation ? {
    waitingDepth: simWaiting.length + simDelayed.length,
    activeCount: simActive.length,
    dlqSize: simDlqCount,
    completedToday: simCompletedCount,
    throughputPerMin: simThroughput,
    workerHealth: {
      active: simWorkers.filter(w => w.status === 'working').length,
      idle: simWorkers.filter(w => w.status === 'idle').length,
      total: simWorkers.length
    },
    redisMemoryMB: '4.82M',
  } : metrics;

  return (
    <div className="dashboard-container">
      <header className="header">
        <div className="header-content">
          <h1>Distributed Job Queue</h1>
          <div className={`status-badge ${isSimulation ? 'sim-mode' : ''}`} style={isSimulation ? {background: 'rgba(245, 158, 11, 0.1)', color: '#fbbf24', borderColor: 'rgba(245, 158, 11, 0.2)'} : {}}>
            <span className="pulse" style={isSimulation ? {backgroundColor: '#fbbf24', boxShadow: '0 0 0 0 rgba(245, 158, 11, 0.7)'} : {}}></span>
            {isSimulation ? 'Simulation Demo Mode' : 'Live Connected'}
          </div>
        </div>
      </header>

      {connectionError && (
        <div className="simulation-banner">
          <span>⚠️ Backend server connect nahi ho saka. Dashboard automatic static demo simulator par chal raha hai.</span>
          <button className="sim-btn-toggle" onClick={() => setIsSimulation(false)}>Reconnect Check</button>
        </div>
      )}

      {!connectionError && (
        <div className="simulation-banner" style={{background: 'rgba(56, 189, 248, 0.05)', color: '#38bdf8', borderColor: 'rgba(56, 189, 248, 0.2)'}}>
          <span>⚙️ Live server test karne ya offline frontend simulation ko force karne ka toggle option:</span>
          <button className="sim-btn-toggle" style={{background: '#38bdf8', color: '#0f172a'}} onClick={() => setIsSimulation(!isSimulation)}>
            {isSimulation ? 'Switch to Live API' : 'Force Simulation'}
          </button>
        </div>
      )}

      {/* Numerical Queue Counters */}
      <main className="grid">
        <div className="card">
          <div className="card-title">Queue Depth</div>
          <div className="card-value">{displayMetrics.waitingDepth}</div>
          <div className="card-subtitle">jobs waiting & delayed</div>
        </div>

        <div className="card">
          <div className="card-title">Throughput</div>
          <div className="card-value">{displayMetrics.throughputPerMin}</div>
          <div className="card-subtitle">jobs/min (rolling 5m)</div>
        </div>

        <div className="card highlight">
          <div className="card-title">Workers Active</div>
          <div className="card-value">
            {displayMetrics.workerHealth?.active} / {displayMetrics.workerHealth?.total || 8}
          </div>
          <div className="card-subtitle">{displayMetrics.workerHealth?.idle} idle workers</div>
        </div>

        <div className="card alert">
          <div className="card-title">DLQ Size</div>
          <div className="card-value">{displayMetrics.dlqSize}</div>
          <div className="card-subtitle">failures (dead-letter)</div>
        </div>

        <div className="card">
          <div className="card-title">Completed Today</div>
          <div className="card-value">{displayMetrics.completedToday}</div>
          <div className="card-subtitle">processed jobs</div>
        </div>

        <div className="card">
          <div className="card-title">Redis Memory</div>
          <div className="card-value">{displayMetrics.redisMemoryMB}</div>
          <div className="card-subtitle">allocated capacity</div>
        </div>
      </main>

      {/* Interactive Controls & Workers status */}
      <div className="sim-section">
        {/* Job Enqueuer Controller */}
        <section className="card">
          <h3 style={{marginBottom: '1rem'}}>Enqueue Job Control</h3>
          <form onSubmit={handleEnqueue} className="control-panel">
            <div className="form-group">
              <label>Job Type</label>
              <select className="select-input" value={jobType} onChange={e => setJobType(e.target.value)}>
                <option value="email:send">email:send (Fast Task)</option>
                <option value="image:resize">image:resize (Medium Task)</option>
                <option value="heavy:task">heavy:task (CPU Heavy Task)</option>
                <option value="failing:task">failing:task (Fails & Retries)</option>
              </select>
            </div>

            <div className="form-group">
              <label>Priority (1 is highest, 10 is lowest)</label>
              <input 
                type="number" 
                className="number-input" 
                min="1" 
                max="10" 
                value={priority} 
                onChange={e => setPriority(e.target.value)}
              />
            </div>

            <div className="form-group">
              <label>Execution Delay (seconds)</label>
              <input 
                type="number" 
                className="number-input" 
                min="0" 
                max="60" 
                value={delay} 
                onChange={e => setDelay(e.target.value)}
              />
            </div>

            <button type="submit" className="btn-primary">
              Enqueue Job {isSimulation ? '(Simulated)' : '(API Server)'}
            </button>
          </form>

          {isSimulation && simWaiting.length > 0 && (
            <div style={{marginTop: '1.5rem'}}>
              <h4 style={{fontSize: '0.8rem', color: 'var(--text-secondary)', marginBottom: '0.5rem', textTransform: 'uppercase'}}>
                Waiting Queue Details ({simWaiting.length})
              </h4>
              <div className="jobs-queue-list">
                {simWaiting.map((job, idx) => (
                  <div key={job.id} className={`job-pill priority-${job.priority <= 3 ? 'high' : job.priority >= 8 ? 'low' : 'mid'}`}>
                    <span>{job.name}</span>
                    <span style={{opacity: 0.7}}>P: {job.priority} | ID: {job.id.slice(0, 6)}</span>
                  </div>
                ))}
              </div>
            </div>
          )}
        </section>

        {/* Worker Threads Status */}
        <section className="workers-section">
          <h3>Worker Threads Status</h3>
          <p style={{fontSize: '0.8rem', color: 'var(--text-secondary)'}}>
            Background workers active lock polling details
          </p>
          <div className="workers-grid">
            {(isSimulation ? simWorkers : Array.from({length: 8}, (_, i) => ({ id: `worker-${i}`, status: 'idle', progress: 0 }))).map(worker => (
              <div key={worker.id} className={`worker-node ${worker.status === 'working' ? 'busy' : ''}`}>
                <div style={{fontWeight: 'bold'}}>{worker.id}</div>
                <div className={`worker-status ${worker.status}`}>
                  {worker.status}
                </div>
                {worker.status === 'working' && (
                  <>
                    <div style={{fontSize: '0.7rem', color: 'var(--text-secondary)', textOverflow: 'ellipsis', overflow: 'hidden', whiteSpace: 'nowrap'}}>
                      {worker.jobName}
                    </div>
                    <div className="progress-bar-container">
                      <div className="progress-bar" style={{ width: `${worker.progress}%` }}></div>
                    </div>
                  </>
                )}
              </div>
            ))}
          </div>
        </section>
      </div>

      {/* Real-time event log display */}
      <section className="logs-section">
        <div className="logs-title">
          <h3>Queue Activity Term Logs</h3>
          <button className="sim-btn-toggle" style={{background: 'rgba(255, 255, 255, 0.05)', color: 'var(--text-primary)', border: '1px solid rgba(255, 255, 255, 0.1)'}} onClick={() => setLogs([])}>
            Clear Term
          </button>
        </div>
        <div className="logs-list">
          {logs.length === 0 ? (
            <div style={{color: 'var(--text-secondary)', textAlign: 'center', padding: '2rem'}}>No logs available</div>
          ) : (
            logs.map(log => (
              <div key={log.id} className={`log-item ${log.type}`}>
                {log.text}
              </div>
            ))
          )}
        </div>
      </section>

      {/* State Machine visual guide */}
      <section className="architecture">
        <h2>Job State Machine Flow</h2>
        <div className="arch-flow">
          <div className="arch-node waiting">Waiting <br/><small>ZSET: priority score</small></div>
          <div className="arch-arrow">▶</div>
          <div className="arch-node active">Active <br/><small>ZSET: lock expiry</small></div>
          <div className="arch-arrow">▶</div>
          <div className="arch-node completed">Completed <br/><small>HASH: job metadata</small></div>
        </div>
      </section>
    </div>
  );
}

export default App;
