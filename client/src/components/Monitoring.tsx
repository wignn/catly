import { useEffect, useRef, useState } from "react";
import { AgentClient, type ServiceInfo } from "../lib/api";
import { loadMetricHistory, saveMetricSample, type MetricRow } from "../lib/db";
import { connectionStatus, evaluateAlerts, mergeAlerts, pollInBatches, recordConnection, type LocalAlert } from "../lib/monitoring";
import { useStore } from "../lib/store";
import { fmtRate } from "../lib/types";
import { enableNotifications, notifyAlert } from "../lib/notifications";
import "./monitoring.css";

function Chart({ rows, field, title }: {rows: MetricRow[]; field:"cpu"|"ram"|"rx_rate"|"tx_rate"; title:string}) {
  const values = rows.map(r => field === "ram" ? 100*r.mem_used/Math.max(1,r.mem_total) : r[field]);
  const ceiling = field === "cpu" || field === "ram" ? 100 : Math.max(1,...values);
  const points = values.map((n,i) => `${i*600/Math.max(1,values.length-1)},${100-Math.min(100,Math.max(0,n*100/ceiling))}`).join(" ");
  return <div className="monitor-chart"><h3>{title}</h3>{rows.length < 2 ? <p className="muted">Menunggu setidaknya dua sampel.</p> : <><svg viewBox="0 0 600 104" role="img" aria-label={`${title}, ${rows.length} sampel; terakhir ${field === "cpu" || field === "ram" ? values.at(-1)?.toFixed(1)+"%" : fmtRate(values.at(-1) ?? 0)}`}><polyline points={points} fill="none" stroke="currentColor" strokeWidth="2" /></svg><p className="muted">{new Date(rows[0].ts*1000).toLocaleString("id-ID")} — {new Date(rows[rows.length-1].ts*1000).toLocaleTimeString("id-ID")} · maksimum {field === "cpu" || field === "ram" ? "100%" : fmtRate(ceiling)}</p></>}</div>;
}

export default function Monitoring() {
  const {state} = useStore();
  const [selected, setSelected] = useState("");
  const [hours,setHours] = useState(24);
  const [rows,setRows] = useState<MetricRow[]>([]);
  const [alerts,setAlerts] = useState<LocalAlert[]>([]);
  const [error,setError] = useState("");
  const [notify,setNotify] = useState(false);
  const [permission,setPermission] = useState("");
  const active = useRef(new Set<string>());
  const notifyRef = useRef(false);
  const [revision,setRevision] = useState(0);
  const id = state.servers.some(s => s.id === selected) ? selected : state.servers[0]?.id ?? "";
  useEffect(() => {notifyRef.current=notify;},[notify]);
  useEffect(() => {
    let alive=true;
    let timer: ReturnType<typeof setTimeout>;
    const services = new Map<string,ServiceInfo[]>();
    const serviceChecks = new Map<string,number>();
    const poll = async () => {
      if (alive) setError("");
      await pollInBatches(state.servers,async server => {
        if (!alive) return;
        const client = new AgentClient(server);
        const started = performance.now();
        let current: LocalAlert[];
        try {
          const [info,snap] = await Promise.all([client.info(),client.metrics()]);
          if (!alive) return;
          recordConnection(server.id,{online:true,lastSeen:Date.now(),version:info.agent_version,latency:Math.round(performance.now()-started),error:undefined});
          if (Date.now()-(serviceChecks.get(server.id) ?? 0)>=60000) {
            serviceChecks.set(server.id,Date.now());
            try { services.set(server.id,(await client.services()).services); }
            catch (e) { if (alive) setError(`Status service ${server.name}: ${(e as Error).message}`); }
          }
          if (!alive) return;
          try {await saveMetricSample(server.id,snap.ts,snap.cpu.total,snap.mem.used,snap.mem.total,snap.net.reduce((n,x)=>n+x.rx_rate,0),snap.net.reduce((n,x)=>n+x.tx_rate,0));}
          catch {if(alive)setError("Riwayat metrik gagal disimpan. Periksa penyimpanan lokal.");}
          current=evaluateAlerts(server.id,snap,services.get(server.id) ?? [],false);
        } catch(e) {
          if (!alive) return;
          recordConnection(server.id,{online:false,error:(e as Error).message});
          current=evaluateAlerts(server.id,null,[],true);
        }
        if (!alive) return;
        const fresh=current.filter(a=>!active.current.has(a.id));
        for (const key of active.current) if (key.startsWith(server.id+":")) active.current.delete(key);
        current.forEach(a=>active.current.add(a.id));
        setAlerts(previous=>mergeAlerts(previous,fresh));
        if(notifyRef.current) {
          for(const alert of fresh.slice(0,3)) void notifyAlert(server.name,alert.message,alert.id).catch(()=>{if(alive)setPermission("Notifikasi tidak didukung platform ini; alert tetap terlihat di aplikasi.");});
        }
      });
      if (alive) {setRevision(n=>n+1);timer=setTimeout(poll,15000);}
    };
    void poll();
    return ()=>{alive=false;clearTimeout(timer);};
  },[state.servers]);
  useEffect(()=>{
    let alive=true;
    if(!id){setRows([]);return;}
    loadMetricHistory(id,Math.floor(Date.now()/1000)-hours*3600).then(r=>{if(alive)setRows(r);}).catch(()=>{if(alive)setError("Riwayat tidak dapat dibaca.");});
    return ()=>{alive=false;};
  },[id,hours,revision]);
  const enable = async()=>{
    if(notify){setNotify(false);return;}
    try {const granted=await enableNotifications();setNotify(granted);setPermission(granted ? "Aktif selama aplikasi terbuka." : "Izin notifikasi belum diberikan; alert tetap tersedia di aplikasi.");}catch{setPermission("Platform tidak dapat meminta izin notifikasi.");}
  };
  return <section><header className="page-heading"><div><h1>Monitoring</h1><p>Riwayat lokal dan alert selama aplikasi terbuka. CPU/RAM/disk ≥ 90%; polling 15 detik, service setiap 60 detik.</p></div><button className="btn" onClick={()=>void enable()}>{notify ? "Matikan notifikasi" : "Aktifkan notifikasi desktop"}</button></header>
    {permission && <p role="status">{permission}</p>}{error && <p className="form-error" role="alert">{error}</p>}
    <div className="monitor-controls"><label>Server <select value={id} onChange={e=>setSelected(e.target.value)}>{state.servers.map(s=><option key={s.id} value={s.id}>{s.name}</option>)}</select></label><label>Periode <select value={hours} onChange={e=>setHours(Number(e.target.value))}><option value={1}>1 jam</option><option value={24}>24 jam</option><option value={168}>7 hari</option></select></label></div>
    {id && <p className="muted">{connectionStatus(id).lastSeen ? `Terakhir terhubung ${new Date(connectionStatus(id).lastSeen!).toLocaleString("id-ID")} · agent v${connectionStatus(id).version} · ${connectionStatus(id).latency} ms` : "Belum berhasil terhubung"}{connectionStatus(id).error && <span className="text-bad"> · {connectionStatus(id).error}</span>}</p>}
    {!id ? <div className="empty panel">Tambahkan server untuk mulai memantau.</div> : <div className="monitor-grid panel"><Chart rows={rows} field="cpu" title="CPU (%)"/><Chart rows={rows} field="ram" title="RAM (%)"/><Chart rows={rows} field="rx_rate" title="Download"/><Chart rows={rows} field="tx_rate" title="Upload"/></div>}
    <section className="panel monitor-alerts"><div className="section-heading"><h2>Alert lokal ({alerts.length}/100)</h2><button className="btn small" onClick={()=>setAlerts([])}>Bersihkan riwayat</button></div><p className="muted">Satu alert per kondisi aktif; muncul kembali setelah pulih lalu terjadi lagi. Maksimum 100 alert sesi ini.</p><ul>{alerts.map(a=><li key={a.id}><strong>{state.servers.find(s=>s.id===a.serverId)?.name ?? a.serverId}</strong> · {a.message} · {new Date(a.ts).toLocaleString("id-ID")}</li>)}</ul>{!alerts.length && <p>Belum ada alert.</p>}</section>
  </section>;
}
