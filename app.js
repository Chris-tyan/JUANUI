
const express = require('express');
const conn = require('./conn');

const app = express();

app.set('view engine', 'ejs');
app.use(express.urlencoded({ extended: true }));

// Landing page
app.get('/', (req, res) => {
    res.render('juan', {
        search: req.query.search || ''
    });
});

// Signup page
app.get('/signup', (req, res) => {
    res.render('signup', { error: '' });
});

// Register user
app.post('/signup', (req, res) => {
    const { name, email, password } = req.body;

    if (!name || !email || !password) {
        return res.status(400).render('signup', {
            error: 'Please complete all fields.'
        });
    }

    conn.query(
        'INSERT INTO users (name, email, password) VALUES (?, ?, ?)',
        [name.trim(), email.trim(), password],
        err => {
            if (err) {
                if (err.code === 'ER_DUP_ENTRY') {
                    return res.status(400).render('signup', {
                        error: 'Email is already registered.'
                    });
                }

                console.error(err);
                return res.status(500).send('Database error.');
            }

            res.redirect('/login');
        }
    );
});

// Student login page
app.get('/login', (req, res) => {
    res.render('login', { error: '' });
});

// Student login and history
app.post('/login', (req, res) => {
    const { email, password } = req.body;

    conn.query(
        'SELECT id, name, email FROM users WHERE email = ? AND password = ?',
        [email, password],
        (err, results) => {
            if (err) {
                console.error(err);
                return res.status(500).send('Database error.');
            }

            if (results.length === 0) {
                return res.status(401).render('login', {
                    error: 'Invalid email or password.'
                });
            }

            const user = results[0];

            conn.query(
                'INSERT INTO login_logs (user_id, name, email) VALUES (?, ?, ?)',
                [user.id, user.name, user.email],
                logErr => {
                    if (logErr) {
                        console.error(logErr);
                        return res.status(500).send(
                            'Could not save login history.'
                        );
                    }

                    res.render('home', {
                        user,
                        search: ''
                    });
                }
            );
        }
    );
});

// Admin login page
app.get('/admin-login', (req, res) => {
    res.render('admin-login', { error: '' });
});

// Admin login
app.post('/admin-login', (req, res) => {
    const { username, password } = req.body;

    conn.query(
        'SELECT id FROM admins WHERE username = ? AND password = ?',
        [username, password],
        (err, results) => {
            if (err) {
                console.error(err);
                return res.status(500).send('Database error.');
            }

            if (results.length === 0) {
                return res.status(401).render('admin-login', {
                    error: 'Invalid username or password.'
                });
            }

            res.setHeader(
                'Set-Cookie',
                'admin=loggedin; HttpOnly; SameSite=Strict; Path=/admin'
            );

            res.redirect('/admin');
        }
    );
});

// Check admin cookie
function isAdmin(req) {
    return (req.headers.cookie || '').split(';').some(
        cookie => cookie.trim() === 'admin=loggedin'
    );
}

// Admin dashboard
app.get('/admin', (req, res) => {
    if (!isAdmin(req)) {
        return res.redirect('/admin-login');
    }

    conn.query(
        'SELECT id, name, email FROM users ORDER BY id DESC',
        (err, users) => {
            if (err) {
                console.error('Loading users failed:', err);
                return res.status(500).send('Database error loading users.');
            }

            conn.query(
                'SELECT * FROM login_logs ORDER BY login_time DESC LIMIT 100',
                (logErr, logs) => {
                    if (logErr) {
                        console.error('Loading login history failed:', logErr);
                        return res.status(500).send(
                            'Database error loading login history.'
                        );
                    }

                    conn.query(
                        `SELECT id, user_id, name, year_level, subject,
                                question, created_at
                         FROM questions
                         ORDER BY created_at DESC`,
                        (questionErr, questionRows) => {
                            if (questionErr) {
                                console.error('Loading questions failed:', questionErr);
                                return res.status(500).send(
                                    'Database error loading questions.'
                                );
                            }

                            conn.query(
                                `SELECT answers.id, answers.user_id,
                                        answers.name, answers.answer,
                                        answers.created_at,
                                        questions.question AS question_text
                                 FROM answers
                                 LEFT JOIN questions
                                 ON answers.question_id = questions.id
                                 ORDER BY answers.created_at DESC`,
                                (answerErr, answerRows) => {
                                    if (answerErr) {
                                        console.error('Loading answers failed:', answerErr);
                                        return res.status(500).send(
                                            'Database error loading answers.'
                                        );
                                    }

                                    // Pass all required variables to admin.ejs
                                    res.render('admin', {
                                        users: users || [],
                                        logs: logs || [],
                                        questions: questionRows || [],
                                        answers: answerRows || []
                                    });
                                }
                            );
                        }
                    );
                }
            );
        }
    );
});

// Delete user
app.post('/admin/delete/:id', (req, res) => {
    if (!isAdmin(req)) {
        return res.redirect('/admin-login');
    }

    conn.query(
        'DELETE FROM users WHERE id = ?',
        [req.params.id],
        err => {
            if (err) {
                console.error(err);
                return res.status(500).send('Could not delete user.');
            }

            res.redirect('/admin');
        }
    );
});

// Delete a question and its answers
app.post('/admin/delete-question/:id', (req, res) => {
    if (!isAdmin(req)) {
        return res.redirect('/admin-login');
    }

    const questionId = req.params.id;

    conn.query(
        'DELETE FROM answers WHERE question_id = ?',
        [questionId],
        err => {
            if (err) {
                console.error(err);
                return res.status(500).send(
                    'Could not delete the question answers.'
                );
            }

            conn.query(
                'DELETE FROM questions WHERE id = ?',
                [questionId],
                deleteErr => {
                    if (deleteErr) {
                        console.error(deleteErr);
                        return res.status(500).send(
                            'Could not delete question.'
                        );
                    }

                    res.redirect('/admin');
                }
            );
        }
    );
});

// Delete one answer
app.post('/admin/delete-answer/:id', (req, res) => {
    if (!isAdmin(req)) {
        return res.redirect('/admin-login');
    }

    conn.query(
        'DELETE FROM answers WHERE id = ?',
        [req.params.id],
        err => {
            if (err) {
                console.error(err);
                return res.status(500).send('Could not delete answer.');
            }

            res.redirect('/admin');
        }
    );
});

// Admin logout
app.post('/admin/logout', (req, res) => {
    res.setHeader(
        'Set-Cookie',
        'admin=; HttpOnly; SameSite=Strict; Path=/admin; Max-Age=0'
    );

    res.redirect('/admin-login');
});

// Home dashboard
app.get('/home', (req, res) => {
    const userId = req.query.user_id;

    if (!userId) {
        return res.redirect('/login');
    }

    conn.query(
        'SELECT id, name, email FROM users WHERE id = ?',
        [userId],
        (err, results) => {
            if (err) {
                console.error(err);
                return res.status(500).send('Database error.');
            }

            if (results.length === 0) {
                return res.redirect('/login');
            }

            res.render('home', {
                user: results[0],
                search: ''
            });
        }
    );
});

// Search subjects and questions
app.get('/search', (req, res) => {
    const userId = req.query.user_id;
    const search = (req.query.q || '').trim();

    if (!userId) {
        return res.redirect('/login');
    }

    conn.query(
        'SELECT id, name, email FROM users WHERE id = ?',
        [userId],
        (err, users) => {
            if (err) {
                console.error(err);
                return res.status(500).send('Database error.');
            }

            if (users.length === 0) {
                return res.redirect('/login');
            }

            const user = users[0];

            if (!search) {
                return res.render('home', {
                    user,
                    search: '',
                    searchResults: []
                });
            }

            const subjects = [
                { year: '1st Year', subject: 'Computer Fundamentals' },
                { year: '1st Year', subject: 'Introduction to Computing' },
                { year: '1st Year', subject: 'Introduction to Programming' },
                { year: '1st Year', subject: 'Basic Web Development' },
                { year: '2nd Year', subject: 'Object-Oriented Programming' },
                { year: '2nd Year', subject: 'Data Structure & Algorthms ' },
                { year: '2nd Year', subject: 'System Integration and Architecture' },
                { year: '3rd Year', subject: 'Advanced Database System' },
                { year: '3rd Year', subject: 'Capsone Project and Research 1' },
                { year: '3rd Year', subject: 'Platforms Technologies' },
                { year: '4th Year', subject: 'Capstone Project and Research 2' },
                { year: '4th Year', subject: 'IT Business Solution' },
                { year: '4th Year', subject: 'Managing IT Resources' }
            ];

            const matchingSubjects = subjects.filter(item =>
                item.subject.toLowerCase().includes(search.toLowerCase())
            );

            const keyword = `%${search}%`;

            conn.query(
                `SELECT id, name, year_level, subject, question, created_at
                 FROM questions
                 WHERE question LIKE ? OR subject LIKE ?
                 ORDER BY created_at DESC`,
                [keyword, keyword],
                (questionErr, questionRows) => {
                    if (questionErr) {
                        console.error(questionErr);
                        return res.status(500).send('Search failed.');
                    }

                    const searchResults = [
                        ...matchingSubjects.map(item => ({
                            type: 'subject',
                            ...item
                        })),
                        ...questionRows.map(item => ({
                            type: 'question',
                            ...item
                        }))
                    ];

                    res.render('home', {
                        user,
                        search,
                        searchResults
                    });
                }
            );
        }
    );
});

// Student logout
app.post('/logout', (req, res) => {
    res.redirect('/login');
});

// View questions and answers for a subject
app.get('/subject', (req, res) => {
    const { year, subject, user_id } = req.query;

    if (!year || !subject || !user_id) {
        return res.status(400).send('Missing subject information.');
    }

    conn.query(
        'SELECT id, name, email FROM users WHERE id = ?',
        [user_id],
        (userErr, userResults) => {
            if (userErr) {
                console.error(userErr);
                return res.status(500).send('Database error.');
            }

            if (userResults.length === 0) {
                return res.redirect('/login');
            }

            const user = userResults[0];

            conn.query(
                `SELECT * FROM questions
                 WHERE year_level = ? AND subject = ?
                 ORDER BY created_at DESC`,
                [year, subject],
                (questionErr, questions) => {
                    if (questionErr) {
                        console.error(questionErr);
                        return res.status(500).send('Database error.');
                    }

                    conn.query(
                        `SELECT answers.*
                         FROM answers
                         INNER JOIN questions
                         ON answers.question_id = questions.id
                         WHERE questions.year_level = ?
                         AND questions.subject = ?
                         ORDER BY answers.created_at ASC`,
                        [year, subject],
                        (answerErr, answers) => {
                            if (answerErr) {
                                console.error(answerErr);
                                return res.status(500).send('Database error.');
                            }

                            res.render('subject', {
                                user,
                                year,
                                subject,
                                questions,
                                answers,
                                error: ''
                            });
                        }
                    );
                }
            );
        }
    );
});

// Add a question
app.post('/questions', (req, res) => {
    const { user_id, year, subject, question } = req.body;

    if (!user_id || !year || !subject || !question || !question.trim()) {
        return res.status(400).send('Please enter a question.');
    }

    conn.query(
        'SELECT id, name FROM users WHERE id = ?',
        [user_id],
        (userErr, userResults) => {
            if (userErr) {
                console.error(userErr);
                return res.status(500).send('Database error.');
            }

            if (userResults.length === 0) {
                return res.redirect('/login');
            }

            const user = userResults[0];

            conn.query(
                `INSERT INTO questions
                 (user_id, name, year_level, subject, question)
                 VALUES (?, ?, ?, ?, ?)`,
                [user.id, user.name, year, subject, question.trim()],
                err => {
                    if (err) {
                        console.error(err);
                        return res.status(500).send(
                            'Could not save your question.'
                        );
                    }

                    const params = new URLSearchParams({
                        year,
                        subject,
                        user_id: String(user.id)
                    });

                    res.redirect('/subject?' + params.toString());
                }
            );
        }
    );
});

// Post an answer
app.post('/answers', (req, res) => {
    const { question_id, user_id, year, subject, answer } = req.body;

    if (!question_id || !user_id || !year || !subject || !answer || !answer.trim()) {
        return res.status(400).send('Please complete the answer.');
    }

    conn.query(
        'SELECT id, name FROM users WHERE id = ?',
        [user_id],
        (userErr, userResults) => {
            if (userErr) {
                console.error(userErr);
                return res.status(500).send('Database error.');
            }

            if (userResults.length === 0) {
                return res.redirect('/login');
            }

            const user = userResults[0];

            conn.query(
                `INSERT INTO answers
                 (question_id, user_id, name, answer)
                 SELECT id, ?, ?, ?
                 FROM questions
                 WHERE id = ?
                 AND year_level = ?
                 AND subject = ?`,
                [user.id, user.name, answer.trim(), question_id, year, subject],
                (err, result) => {
                    if (err) {
                        console.error(err);
                        return res.status(500).send(
                            'Could not save your answer.'
                        );
                    }

                    if (result.affectedRows === 0) {
                        return res.status(404).send('Question not found.');
                    }

                    const params = new URLSearchParams({
                        year,
                        subject,
                        user_id: String(user.id)
                    });

                    res.redirect('/subject?' + params.toString());
                }
            );
        }
    );
});

// Start server
app.listen(9000, '0.0.0.0', () => {
    console.log('JuanUI running on port 9000');
});
