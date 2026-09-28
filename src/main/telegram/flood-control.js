function wait(ms) {
  return new Promise(r=>setTimeout(r,ms))
}
function floodSeconds(e) {
  if(e&&typeof e.seconds==='number')return e.seconds;
  const m=String(e&&e.message||'').match(/FLOOD_WAIT_?(\d+)/);
  return m?Number(m[1]):0
}
module.exports= {
  wait,floodSeconds
}
