document.addEventListener('DOMContentLoaded', async () => {
  try {
    // get the API response from storage
    const result = await chrome.storage.local.get(['cmApiResponse']);
    const apiResponse = result.cmApiResponse;

    if (!apiResponse) {
      showError('Brak danych do wyświetlenia');
      return;
    }

    hideLoading();
    displayResults(apiResponse);
    
    // add event listeners for section headers
    setupEventListeners();
  } catch (error) {
    console.error('Error loading results:', error);
    showError('Błąd podczas ładowania wyników');
  }
});

function setupEventListeners() {
  document.querySelectorAll('.section-header').forEach(header => {
    header.addEventListener('click', () => {
      const sectionType = header.getAttribute('data-section');
      toggleSection(sectionType);
    });
  });
}

function hideLoading() {
  document.getElementById('loading').style.display = 'none';
  document.getElementById('content').style.display = 'block';
}

function showError(message) {
  hideLoading();
  document.getElementById('content').innerHTML = `
    <div class="empty-state">
      <div class="icon">❌</div>
      <div>${message}</div>
    </div>
  `;
}

function displayResults(apiResponse) {
  const clickCodes = apiResponse.click || [];
  const viewCodes = apiResponse.view || [];

  // update counts
  document.getElementById('clickCount').textContent = clickCodes.length;
  document.getElementById('viewCount').textContent = viewCodes.length;

  // display click codes
  const clickContainer = document.getElementById('clickCodes');
  if (clickCodes.length === 0) {
    clickContainer.innerHTML = `
      <div class="empty-state">
        <div class="icon">📭</div>
        <div>Brak kodów kliknięć</div>
      </div>
    `;
  } else {
    clickContainer.innerHTML = clickCodes.map(codeData => createCodeItem(codeData)).join('');
  }

  // display view codes
  const viewContainer = document.getElementById('viewCodes');
  if (viewCodes.length === 0) {
    viewContainer.innerHTML = `
      <div class="empty-state">
        <div class="icon">📭</div>
        <div>Brak kodów wyświetleń</div>
      </div>
    `;
  } else {
    viewContainer.innerHTML = viewCodes.map(codeData => createCodeItem(codeData)).join('');
  }
}

function createCodeItem(codeData) {
  const hasError = codeData.error_msg && codeData.error_msg.trim() !== '';
  
  if (hasError) {
    return `
      <div class="code-item">
        <div class="error-message">
          Błąd: ${codeData.error_msg}
        </div>
        <div class="code-link">${codeData.link || 'Brak linku'}</div>
      </div>
    `;
  }

  const response = codeData.response || {};
  const tableRows = Object.entries(response)
    .map(([key, value]) => `
      <tr>
        <td><strong>${key}</strong></td>
        <td>${value !== null && value !== undefined ? value : 'N/A'}</td>
      </tr>
    `)
    .join('');

  return `
    <div class="code-item">
      <div class="code-link">${codeData.link || 'Brak linku'}</div>
      <table class="code-table">
        <thead>
          <tr>
            <th>Pole</th>
            <th>Wartość</th>
          </tr>
        </thead>
        <tbody>
          ${tableRows}
        </tbody>
      </table>
    </div>
  `;
}

function toggleSection(sectionType) {
  const content = document.getElementById(`${sectionType}Content`);
  const chevron = document.getElementById(`${sectionType}Chevron`);
  const header = chevron.closest('.section-header');

  if (content.classList.contains('expanded')) {
    content.classList.remove('expanded');
    header.classList.add('collapsed');
  } else {
    content.classList.add('expanded');
    header.classList.remove('collapsed');
  }
}