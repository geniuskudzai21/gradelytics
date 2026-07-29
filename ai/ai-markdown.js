function formatMarkdown(text) {
    const escaped = text
        .replace(/&/g, '&amp;')
        .replace(/</g, '&lt;')
        .replace(/>/g, '&gt;');
    let html = escaped
        .replace(/### (.+)/g, '<h5>$1</h5>')
        .replace(/## (.+)/g, '<h4>$1</h4>')
        .replace(/# (.+)/g, '<h3>$1</h3>')
        .replace(/\*\*(.+?)\*\*/g, '<strong>$1</strong>')
        .replace(/\*(.+?)\*/g, '<em>$1</em>')
        .replace(/`([^`]+)`/g, '<code>$1</code>')
        .replace(/^---+$/gm, '<hr>');
    const lines = html.split('\n');
    let result = [], inList = false, listType = null;
    for (let i = 0; i < lines.length; i++) {
        const line = lines[i];
        const ulMatch = line.match(/^[-*] (.+)/);
        const olMatch = line.match(/^(\d+)[.)] (.+)/);
        if (ulMatch) {
            if (!inList || listType !== 'ul') {
                if (inList) result.push('</' + listType + '>');
                result.push('<ul>');
                inList = true;
                listType = 'ul';
            }
            result.push('<li>' + ulMatch[1] + '</li>');
        } else if (olMatch) {
            if (!inList || listType !== 'ol') {
                if (inList) result.push('</' + listType + '>');
                result.push('<ol>');
                inList = true;
                listType = 'ol';
            }
            result.push('<li>' + olMatch[2] + '</li>');
        } else {
            if (inList) { result.push('</' + listType + '>'); inList = false; listType = null; }
            if (line.trim() === '') {
                result.push('');
            } else if (
                !line.startsWith('<h3') && !line.startsWith('<h4') && !line.startsWith('<h5') && !line.startsWith('<hr')
            ) {
                result.push('<p>' + line + '</p>');
            } else {
                result.push(line);
            }
        }
    }
    if (inList) result.push('</' + listType + '>');
    return result.join('\n');
}
