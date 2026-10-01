/** Keep the clear action focusable while busy; the caller owns its transaction. */
export function bindClearLayersControl(button, clear) {
  let destroyed = false;
  const click = () => {
    if (!destroyed) void clear();
  };
  button?.addEventListener('click', click);
  return {
    setBusy(busy) {
      if (destroyed || !button) return;
      button.setAttribute('aria-disabled', String(busy));
      button.setAttribute('aria-busy', String(busy));
      button.setAttribute(
        'aria-label',
        busy ? 'Borrando las capas de datos seleccionadas' : 'Borrar las capas de datos seleccionadas',
      );
    },
    destroy() {
      destroyed = true;
      button?.removeEventListener('click', click);
    },
  };
}
