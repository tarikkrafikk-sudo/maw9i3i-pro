/* ============================================================
   mawqi3i.ma — script.js
   ============================================================
   1) CONFIG: بدل رقم الواتساب والاثمنة هنا، غادي يتبدلو
      اوتوماتيكيا فكامل الصفحة.
   2) Smooth scroll ديال روابط المنيو (بحساب ارتفاع الهيدر الثابت).
   3) منيو الموبايل (فتح/سد).
   ============================================================ */

const CONFIG = {
  // رقم الواتساب بصيغة دولية بلا "+" وبلا مسافات.
  whatsapp: "212698905967",
  prices: {
    vitrine: 2490,
    wordpress: 4990,
    wordpressYear: 600,
    ecommerce: 8990,
    saas: 16900,
    blog: 3490,
    landing: 1290
  }
};

document.addEventListener("DOMContentLoaded", () => {

  /* ---------- 1) تحديث الاثمنة انطلاقا من CONFIG.prices ---------- */
  document.querySelectorAll("[data-price]").forEach((el) => {
    const key = el.getAttribute("data-price");
    if (CONFIG.prices[key] !== undefined) {
      el.textContent = CONFIG.prices[key].toLocaleString("fr-FR");
    }
  });

  /* ---------- 2) تفعيل ازرار الواتساب برقم ورسالة كل واحد ---------- */
  const DEFAULT_WA_MSG =
    "Bienvenue sur la plateforme MAW9I3I ✨\n\n" +
    "Merci de nous avoir contactés.\n" +
    "Nous sommes spécialisés dans la création de tous types de sites web professionnels : vitrines, e-commerce, portfolio, landing page, blog et plus.\n\n" +
    "Comment pouvons-nous vous aider aujourd'hui ?";

  document.querySelectorAll(".js-wa").forEach((el) => {
    const msg = el.getAttribute("data-msg") || DEFAULT_WA_MSG;
    // .replace(/'/g, "%27") : encodeURIComponent وحدو ما كيبدلش الأبوستروف
    // (') لأنها محسوبة "unreserved" فـ JS، بصح باش وتساب يقرا الرسالة
    // كاملة بلا قطع خاصنا نكودياها يدويا هي الوحيدة.
    const encoded = encodeURIComponent(msg).replace(/'/g, "%27");
    el.setAttribute("href", `https://wa.me/${CONFIG.whatsapp}?text=${encoded}`);
    el.setAttribute("target", "_blank");
    el.setAttribute("rel", "noopener");
  });

  /* ---------- 3) Smooth scroll لروابط المنيو (Header + Mobile) ---------- */
  const header = document.querySelector("header");
  const getHeaderOffset = () => (header ? header.offsetHeight : 0) + 12;

  document.querySelectorAll('a[href^="#"]').forEach((link) => {
    link.addEventListener("click", (e) => {
      const id = link.getAttribute("href");
      if (!id || id === "#") return;
      const target = document.querySelector(id);
      if (!target) return;

      e.preventDefault();
      const top = target.getBoundingClientRect().top + window.pageYOffset - getHeaderOffset();
      window.scrollTo({ top, behavior: "smooth" });

      // سد منيو الموبايل اذا كان مفتوح بعد الضغط على رابط
      const mobileMenu = document.getElementById("mobileMenu");
      if (mobileMenu && mobileMenu.classList.contains("open")) {
        mobileMenu.classList.remove("open");
      }
    });
  });

  /* ---------- 4) منيو الموبايل: فتح / سد ---------- */
  const burgerBtn = document.getElementById("burgerBtn");
  const mobileMenu = document.getElementById("mobileMenu");
  if (burgerBtn && mobileMenu) {
    burgerBtn.addEventListener("click", () => {
      mobileMenu.classList.toggle("open");
    });
  }

  /* ---------- 5) السنة الحالية فالفوتر ---------- */
  const yearEl = document.getElementById("year");
  if (yearEl) yearEl.textContent = new Date().getFullYear();
});
