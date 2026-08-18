/**
 * 外部向け 問い合わせフォーム（inquiry.html）
 *
 * 施設を使いたい方が、アプリを開かずに掲示板へ直接相談を貼れるようにする窓口です。
 * 保存先はアプリ内の「相談を貼る」とまったく同じ chikado_inquiries なので、
 * 送られた内容はそのまま掲示板に付箋として並びます。
 *
 * - チカ堂担当者（staff）は聞かず、空欄のまま登録します（掲示板側で「担当者 未定」と強調されます）
 * - 相談内容は「施設予約」と「その他」で分岐し、その他は自由記述だけで完結します
 */

import { Inquiries, ApiError } from './api.js';
import { el, applyInquiryCategory } from './util.js';

const $ = (sel) => document.querySelector(sel);

const form = $('#public-form');
const alertBox = $('#public-alert');
const submitBtn = $('#public-submit');
const card = $('#public-card');
const done = $('#public-done');

function toast(message, kind = 'info') {
  const node = el('div', { class: `toast${kind === 'error' ? ' is-error' : ''}`, text: message });
  $('#toast-wrap').append(node);
  setTimeout(() => {
    node.style.transition = 'opacity .25s ease';
    node.style.opacity = '0';
    setTimeout(() => node.remove(), 260);
  }, kind === 'error' ? 5200 : 2800);
}

function currentCategory() {
  return form.querySelector('input[name="category"]:checked')?.value || 'facility';
}

function showAlert(text) {
  alertBox.textContent = text;
  alertBox.hidden = false;
  alertBox.scrollIntoView({ block: 'nearest', behavior: 'smooth' });
}

function readForm() {
  const category = currentCategory();
  const other = category === 'other';
  const val = (name) => (form.elements[name]?.value || '').trim();

  return {
    title: val('title'),
    category,
    status: 'open',
    source: 'public',
    staff: '',                                       // 担当者は外部の方には聞かない
    desired_period: other ? '' : val('desired_period'),
    purpose: val('purpose'),
    organizer: val('organizer'),
    contact_email: val('contact_email'),
    contact_phone: val('contact_phone'),
    headcount: other || val('headcount') === '' ? null : Number(val('headcount')),
    notes: other ? '' : val('notes'),
  };
}

function validate(v) {
  const other = v.category === 'other';
  const errors = [];
  if (!v.title) errors.push('・件名を入力してください。');
  if (!v.purpose) errors.push(other ? '・お問い合わせ内容を入力してください。' : '・利用内容を入力してください。');
  if (!v.organizer) errors.push('・お名前・団体名を入力してください。');
  if (!v.contact_email && !v.contact_phone) {
    errors.push('・メールアドレスか電話番号のどちらかを入力してください。');
  }
  if (v.contact_email && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(v.contact_email)) {
    errors.push('・メールアドレスの形式をご確認ください。');
  }
  if (v.headcount !== null && (!Number.isFinite(v.headcount) || v.headcount < 0)) {
    errors.push('・想定人数は 0 以上の数値で入力してください。');
  }
  return errors;
}

function showDone(v) {
  $('#public-done-text').textContent = v.contact_email
    ? `${v.organizer} さま、ありがとうございます。担当者が内容を確認のうえ、${v.contact_email} 宛にご連絡します。`
    : `${v.organizer} さま、ありがとうございます。担当者が内容を確認のうえ、いただいたお電話番号へご連絡します。`;
  card.hidden = true;
  done.hidden = false;
  window.scrollTo({ top: 0, behavior: 'smooth' });
}

async function submit() {
  // 自動投稿よけ。人には見えない欄が埋まっていたら、何もせず完了したふりをする
  if ((form.elements.website?.value || '').trim()) { showDone(readForm()); return; }

  const v = readForm();
  const errors = validate(v);
  if (errors.length) {
    showAlert(`入力内容をご確認ください。\n${errors.join('\n')}`);
    return;
  }

  alertBox.hidden = true;
  submitBtn.disabled = true;
  try {
    await Inquiries.create(v);
    showDone(v);
  } catch (err) {
    console.error(err);
    showAlert(err instanceof ApiError
      ? `送信できませんでした。\n${err.message}`
      : '送信できませんでした。しばらくしてからもう一度お試しください。');
    toast('送信できませんでした', 'error');
  } finally {
    submitBtn.disabled = false;
  }
}

form.addEventListener('submit', (e) => { e.preventDefault(); submit(); });

form.querySelectorAll('input[name="category"]').forEach((r) => {
  r.addEventListener('change', () => applyInquiryCategory(form, r.value));
});

$('#public-again').addEventListener('click', () => {
  form.reset();
  applyInquiryCategory(form, 'facility');
  alertBox.hidden = true;
  done.hidden = true;
  card.hidden = false;
  form.elements.title.focus();
});

applyInquiryCategory(form, currentCategory());
