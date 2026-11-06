// Shared: highlight the current mode in the mode bar.
(function(){const q=new URLSearchParams(location.search).get('mode'),tools=/tools\.html$/.test(location.pathname),mode=tools?(q==='convert'?'convert':'compress'):(q==='doc'?'doc':'slide');
document.documentElement.dataset.mode=mode;window.PICTO_MODE=mode;
document.querySelectorAll('.modes a').forEach(a=>{if(a.dataset.mode===mode){a.classList.add('active');a.setAttribute('aria-current','page')}});})();
