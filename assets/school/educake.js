(async function() {
    'use strict';

    // --- Part 1: Setup and Library Loading ---
    function loadScript(src) {
        return new Promise((resolve, reject) => {
            if (window.jQuery && src.includes('jquery')) return resolve();
            const script = document.createElement('script');
            script.src = src;
            script.onload = resolve;
            script.onerror = () => reject(new Error(`Failed to load script: ${src}`));
            document.head.appendChild(script);
        });
    }

    try {
        await loadScript('https://code.jquery.com/jquery-3.7.1.min.js');
        $ = jQuery.noConflict();
        console.log("jQuery loaded successfully.");
    } catch (error) {
        alert("Failed to load jQuery. The script cannot run.");
        console.error(error);
        return;
    }

    // --- Part 2: Authentication and State ---
    let authToken = sessionStorage.getItem("token");
    let xsrfToken = (match => match ? decodeURIComponent(match[1]) : null)(document.cookie.match(/XSRF-TOKEN=([^;]+)/));

    if (!authToken || !xsrfToken) {
        alert("Authorization tokens not found. Please ensure you are logged in.");
        return;
    }

    let match = window.location.pathname.match(/quiz\/(\d+)/);
    if (!match) {
        alert("Could not find Quiz ID. Make sure you are on a quiz page.");
        return;
    }
    let quizId = match[1];
    let quizStructure = null;
    let allAnswers = []; // This will store answers in order: [answer1, answer2, ...]

    // --- Part 3: UI Creation ---
    let themeColors = { primary: '#000000', secondary: '#e63946', accent: '#ff4d6d', text: '#ffffff', background: 'rgba(0, 0, 0, 0.9)', shadow: 'rgba(230, 57, 70, 0.6)' };
    function updateAnswerBox(content) {
        const answerContent = document.getElementById("answerContent");
        if (answerContent) answerContent.innerHTML = content;
    }
    function createAnswerBox(initialMessage) {
        if (document.getElementById("answerBox")) return;
        let answerBox = document.createElement("div"); answerBox.id = "answerBox";
        Object.assign(answerBox.style, { position: 'fixed', bottom: '20px', right: '20px', width: '350px', maxHeight: '400px', overflowY: 'auto', padding: '15px', borderRadius: '10px', zIndex: '9999', fontFamily: "'Segoe UI', Tahoma, Geneva, Verdana, sans-serif", fontSize: '14px', background: themeColors.background, boxShadow: `0 4px 20px ${themeColors.shadow}`, borderLeft: `4px solid ${themeColors.secondary}`, color: themeColors.text, display: 'none' });
        let answerContent = document.createElement("div"); answerContent.id = "answerContent"; answerContent.innerHTML = initialMessage;
        let closeButton = document.createElement("button"); closeButton.innerText = "Close";
        Object.assign(closeButton.style, { marginTop: '10px', padding: '8px 15px', border: 'none', borderRadius: '5px', background: themeColors.secondary, color: themeColors.text, cursor: 'pointer', fontWeight: 'bold', transition: 'all 0.2s ease' });
        closeButton.onmouseover = () => closeButton.style.background = themeColors.accent; closeButton.onmouseout = () => closeButton.style.background = themeColors.secondary; closeButton.onclick = () => answerBox.style.display = 'none';
        answerBox.append(answerContent, closeButton); document.body.appendChild(answerBox);
        let toggleButton = document.createElement("button"); toggleButton.innerText = "Auto-Answer"; toggleButton.id = "toggleButton";
        Object.assign(toggleButton.style, { position: 'fixed', bottom: '20px', left: '20px', padding: '12px 20px', border: 'none', borderRadius: '30px', color: themeColors.text, cursor: 'pointer', zIndex: '9999', fontWeight: 'bold', transition: 'all 0.2s ease', boxShadow: `0 2px 10px ${themeColors.shadow}`, background: themeColors.secondary });
        toggleButton.onclick = () => { answerBox.style.display = 'block'; startAutoAnswer(); };
        document.body.appendChild(toggleButton);
    }

    // --- Part 4: Core Logic ---

    function waitForElement(selector, timeout = 5000) {
        return new Promise((resolve, reject) => {
            const element = $(selector);
            if (element.length > 0) return resolve(element[0]);
            const observer = new MutationObserver(() => {
                const element = $(selector);
                if (element.length > 0) { observer.disconnect(); resolve(element[0]); }
            });
            observer.observe(document.body, { childList: true, subtree: true });
            setTimeout(() => { observer.disconnect(); reject(new Error(`Timeout waiting for selector "${selector}"`)); }, timeout);
        });
    }

    function getQuestionNumber() {
        const questionHeader = $('h3 > span:contains("Question ")').parent('h3');
        if (questionHeader.length) {
            const questionText = questionHeader.text();
            const match = questionText.match(/Question (\d+) of (\d+)/);
            if (match) {
                return parseInt(match[1], 10);
            }
        }
        return null;
    }

    async function startAutoAnswer() {
        updateAnswerBox("Step 1: Fetching all quiz answers...");
        try {
            const response = await fetch(`https://my.educake.co.uk/api/student/quiz/${quizId}`, {
                method: 'GET', headers: { 'Accept': 'application/json;version=2', 'Authorization': `Bearer ${authToken}`, 'X-XSRF-TOKEN': xsrfToken }
            });
            if (!response.ok) throw new Error("Failed to fetch quiz structure.");
            quizStructure = await response.json();
        } catch (error) {
            console.error(error); updateAnswerBox("Error: Could not get quiz information."); return;
        }

        const questionIds = quizStructure.attempt[quizId]?.questions;
        if (!questionIds || questionIds.length === 0) { updateAnswerBox("No questions found in the quiz."); return; }

        const totalQuestions = questionIds.length;
        updateAnswerBox(`Step 2: Fetching answers for ${totalQuestions} questions...`);

        // Pre-fetch all answers
        for (let i = 0; i < totalQuestions; i++) {
            const questionId = questionIds[i];
            try {
                const res = await fetch(`https://my.educake.co.uk/api/course/question/${questionId}/mark`, {
                    method: 'POST', headers: { 'Accept': 'application/json;version=2', 'Authorization': `Bearer ${authToken}`, 'X-XSRF-TOKEN': xsrfToken, 'Content-Type': 'application/json' }, body: JSON.stringify({ "givenAnswer": "1" })
                });
                if (!res.ok) throw new Error(`API Error for question ${questionId}`);
                const data = await res.json();
                const correctAnswer = data.answer?.correctAnswers[0];
                allAnswers[i] = correctAnswer; // Store answer by its index (0-based)
            } catch (error) {
                console.error(error);
                allAnswers[i] = null; // Mark as failed
            }
        }
        updateAnswerBox(`Step 3: Starting to answer questions...`);

        // Main loop - continues until all questions are done
        let currentQNum = 0;
        while (currentQNum < totalQuestions) {
            currentQNum = getQuestionNumber();
            if (!currentQNum) {
                updateAnswerBox("Could not determine current question number. Waiting...");
                await new Promise(r => setTimeout(r, 2000));
                continue;
            }

            const currentAnswer = allAnswers[currentQNum - 1];
            if (!currentAnswer) {
                updateAnswerBox(`Skipping question ${currentQNum} due to fetch error.`);
                await new Promise(r => setTimeout(r, 3000));
                continue;
            }

            // UPDATED: Check if it's a text question using the new selector
            const isTextQuestion = $('input.answer-text').length > 0;

            if (isTextQuestion) {
                updateAnswerBox(`Q${currentQNum} (Text): Typing answer...`);
                // UPDATED: Use the new selector for text input
                const textBox = $('input.answer-text');
                if (textBox.length > 0) {
                    textBox.val(currentAnswer);
                    textBox[0].dispatchEvent(new Event('input', { bubbles: true }));
                    console.log(`Typed answer "${currentAnswer}" into text box.`);
                    
                    // UPDATED: Use more specific selectors for buttons
                    let submitButtonClicked = false;
                    const selectors = [
                        'button:contains("Submit")',
                        'button.btn:contains("Submit")',
                        'button[class*="submit"]:contains("Submit")',
                        'button[type="submit"]'
                    ];
                    for (const selector of selectors) {
                        try {
                            console.log(`Text: Trying selector: ${selector}`);
                            const submitButton = await waitForElement(selector, 3000);
                            submitButton.click();
                            console.log("Text: Successfully clicked submit button.");
                            submitButtonClicked = true;
                            break;
                        } catch (e) {
                            console.warn(`Text: Selector failed: ${selector}`);
                        }
                    }

                    if (submitButtonClicked) {
                        await new Promise(r => setTimeout(r, 500));
                        try {
                            // UPDATED: More specific selector for next button
                            await waitForElement('button:contains("Next question"), button:contains("Next")', 3000);
                            const nextQuestionButton = $('button:contains("Next question"), button:contains("Next")');
                            if (nextQuestionButton.length > 0) {
                                nextQuestionButton.click();
                                console.log("Text: Clicked 'Next question' button after text submit.");
                            }
                        } catch (e_next) {
                            console.warn("Text: Could not find the 'Next question' button after text submit.");
                        }
                    } else {
                        console.error("Text: Could not find the text submit button with any selector.");
                    }
                }
            } else {
                // It's a multiple-choice question
                updateAnswerBox(`Q${currentQNum} (Multiple Choice): Clicking answer...`);
                const inputElement = $(`input[value="${CSS.escape(currentAnswer)}"]`);
                if (inputElement.length > 0) {
                    const labelToClick = inputElement.closest('label');
                    if (labelToClick.length > 0) {
                        labelToClick[0].click();
                        console.log(`Successfully clicked: "${currentAnswer}"`);
                    }
                }

                // --- UPDATED MCQ NAVIGATION LOGIC ---
                // 1. Click the "Submit" button
                let submitButtonClicked = false;
                const selectors = [
                    'button:contains("Submit")',
                    'button.btn:contains("Submit")',
                    'button[class*="submit"]:contains("Submit")',
                    'button[type="submit"]'
                ];
                for (const selector of selectors) {
                    try {
                        console.log(`MCQ: Trying selector: ${selector}`);
                        const submitButton = await waitForElement(selector, 3000);
                        submitButton.click();
                        console.log("MCQ: Successfully clicked submit button.");
                        submitButtonClicked = true;
                        break;
                    } catch (e) {
                        console.warn(`MCQ: Selector failed: ${selector}`);
                    }
                }

                if (submitButtonClicked) {
                    // 2. On the review screen, click the "Next" arrow
                    await new Promise(r => setTimeout(r, 500));
                    try {
                        await waitForElement('.arrow-right:not([disabled]), button:contains("Next")', 3000);
                        const nextArrow = $('.arrow-right:not([disabled]), button:contains("Next")');
                        if (nextArrow.length > 0) nextArrow.click();
                        console.log("MCQ: Clicked next arrow.");
                    } catch (e) { console.warn("MCQ: Could not find next arrow."); }
                    
                    // 3. On the transition screen, click the "Next question" button
                    await new Promise(r => setTimeout(r, 500));
                    try {
                        await waitForElement('button:contains("Next question"), button:contains("Next")', 3000);
                        const nextQuestionButton = $('button:contains("Next question"), button:contains("Next")');
                        if (nextQuestionButton.length > 0) nextQuestionButton.click();
                        console.log("MCQ: Clicked 'Next question' button.");
                    } catch (e) { console.warn("MCQ: Could not find 'Next question' button."); }
                } else {
                    console.error("MCQ: Could not find the submit button with any selector.");
                }
            }
            
            // Wait for the next question to load
            await new Promise(r => setTimeout(r, 1500));
        }

        updateAnswerBox("All questions answered. Submitting quiz...");
        try {
            const submitButton = await waitForElement('button:contains("Submit quiz"), button:contains("Submit"), button.btn.green:not([disabled])', 5000);
            if (submitButton.innerText.toLowerCase().includes('submit')) {
                submitButton.click();
                updateAnswerBox("Quiz submitted successfully!");
            } else {
                throw new Error("Found a button, but it wasn't the 'Submit' button.");
            }
        } catch (error) {
            console.error("Submit Error:", error);
            updateAnswerBox("Could not find the final submit button. Please submit manually.");
        }
    }

    // --- Initialize ---
    createAnswerBox("Ready. Click 'Auto-Answer' to begin.");
})();
