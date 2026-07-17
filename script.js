document.getElementById("mt")?.addEventListener("click",()=>document.getElementById("links").classList.toggle("open"));
document.querySelectorAll("[data-goto]").forEach(c=>c.addEventListener("click",()=>location.href=c.dataset.goto+".html"));
(function(){
  const c=document.getElementById("heroCarousel"); if(!c) return;
  const slides=c.querySelector(".slides"); const total=slides.children.length;
  const dots=[...c.querySelectorAll(".cdots span")]; let i=0, timer;
  const reduce=window.matchMedia("(prefers-reduced-motion:reduce)").matches;
  function go(n){ i=(n+total)%total; slides.style.transform="translateX(-"+(i*100)+"%)"; dots.forEach((d,k)=>d.classList.toggle("active",k===i)); }
  function reset(){ if(reduce) return; clearInterval(timer); timer=setInterval(()=>go(i+1),4500); }
  c.querySelector(".cnext").addEventListener("click",()=>{go(i+1);reset();});
  c.querySelector(".cprev").addEventListener("click",()=>{go(i-1);reset();});
  dots.forEach((d,k)=>d.addEventListener("click",()=>{go(k);reset();}));
  reset();
})();
