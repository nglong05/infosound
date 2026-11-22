// Each overlay owns one token; closing a lower layer cannot unlock an upper one.
const owners = new Set<symbol>();
let previousOverflow = '';
export function lockBodyScroll() {
  const token = Symbol('body-scroll');
  if (!owners.size) previousOverflow = document.body.style.overflow;
  owners.add(token);
  document.body.style.overflow = 'hidden';
  return () => {
    if (!owners.delete(token)) return;
    if (!owners.size) document.body.style.overflow = previousOverflow;
  };
}
