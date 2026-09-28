function extract(text='') {
  const re=/(?:https?:\/\/)?t\.me\/(?:joinchat\/|\+)?([A-Za-z0-9_+-]+)/gi;
  const out=[];
  let m;
  while((m=re.exec(text)))out.push( {
    url:m[0].startsWith('http')?m[0]:'https://'+m[0],username:m[1]
  });
  return [...new Map(out.map(x=>[x.url,x])).values()]
}
module.exports= {
  extract
}
