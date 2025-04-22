let chalk;

(async () => {
    const chalkModule = await import('chalk');
    chalk = chalkModule.default;
})();

const getColor = (style, text) => {
    if (!chalk) {
        return text;
    }
    let colorFunc = chalk;
    const styles = style.split('.');
    for (const s of styles) {
        if (colorFunc[s]) {
            colorFunc = colorFunc[s];
        } else {
            return text;
        }
    }
    return colorFunc(text);
};

module.exports = {
    info: (text) => getColor('blue', text),
    success: (text) => getColor('green', text),
    error: (text) => getColor('red.bold', text),
    warning: (text) => getColor('yellow', text),
    debug: (text) => getColor('gray', text),
    header: (text) => getColor('magenta.bold', text),
    user: (num) => getColor('cyan', `User ${num}`),
    details: (text) => getColor('dim', text),
    invite: (text) => getColor('yellow.italic', text),
    message: (text) => getColor('white', text),
    pass: (text) => getColor('bgGreen.black', text),
    fail: (text) => getColor('bgRed.black', text),
}; 