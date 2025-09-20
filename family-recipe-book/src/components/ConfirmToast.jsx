import React from 'react';
import { toast } from 'react-toastify';

function ConfirmToast({ message, onConfirm, closeToast }) {

  const handleConfirm = () => {
    onConfirm();
    closeToast();
  };

  return (
    <div className="confirm-toast">
      <p>{message}</p>
      <div className="confirm-toast-buttons">
        <button onClick={handleConfirm} className="confirm-yes">Yes</button>
        <button onClick={closeToast} className="confirm-no">No</button>
      </div>
    </div>
  );
}

export default ConfirmToast;