--
-- PostgreSQL database dump
--

-- Dumped from database version 15.4
-- Dumped by pg_dump version 15.4

SET statement_timeout = 0;
SET lock_timeout = 0;
SET idle_in_transaction_session_timeout = 0;
SET client_encoding = 'UTF8';
SET standard_conforming_strings = on;
SELECT pg_catalog.set_config('search_path', '', false);
SET check_function_bodies = false;
SET xmloption = content;
SET client_min_messages = warning;
SET row_security = off;

--
-- Name: booking_status; Type: TYPE; Schema: public; Owner: -
--

CREATE TYPE public.booking_status AS ENUM (
    'confirmed',
    'completed',
    'cancelled'
);


--
-- Name: slot_status; Type: TYPE; Schema: public; Owner: -
--

CREATE TYPE public.slot_status AS ENUM (
    'available',
    'booked',
    'cancelled'
);


--
-- Name: user_role; Type: TYPE; Schema: public; Owner: -
--

CREATE TYPE public.user_role AS ENUM (
    'teacher',
    'student',
    'moderator'
);


SET default_tablespace = '';

SET default_table_access_method = heap;

--
-- Name: bookings; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.bookings (
    id integer NOT NULL,
    student_id integer NOT NULL,
    availability_id integer NOT NULL,
    status public.booking_status DEFAULT 'confirmed'::public.booking_status,
    created_at timestamp without time zone DEFAULT CURRENT_TIMESTAMP
);


--
-- Name: bookings_id_seq; Type: SEQUENCE; Schema: public; Owner: -
--

CREATE SEQUENCE public.bookings_id_seq
    AS integer
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1;


--
-- Name: bookings_id_seq; Type: SEQUENCE OWNED BY; Schema: public; Owner: -
--

ALTER SEQUENCE public.bookings_id_seq OWNED BY public.bookings.id;


--
-- Name: password_resets; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.password_resets (
    id integer NOT NULL,
    user_id integer NOT NULL,
    token_hash text NOT NULL,
    expires_at timestamp with time zone NOT NULL,
    created_at timestamp with time zone DEFAULT now() NOT NULL
);


--
-- Name: password_resets_id_seq; Type: SEQUENCE; Schema: public; Owner: -
--

CREATE SEQUENCE public.password_resets_id_seq
    AS integer
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1;


--
-- Name: password_resets_id_seq; Type: SEQUENCE OWNED BY; Schema: public; Owner: -
--

ALTER SEQUENCE public.password_resets_id_seq OWNED BY public.password_resets.id;


--
-- Name: session; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.session (
    sid character varying NOT NULL,
    sess json NOT NULL,
    expire timestamp(6) without time zone NOT NULL
);


--
-- Name: students; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.students (
    user_id integer NOT NULL,
    f_name character varying(100) NOT NULL,
    l_name character varying(100) NOT NULL,
    phone_number character varying(30)
);


--
-- Name: teacher_availability; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.teacher_availability (
    id integer NOT NULL,
    teacher_id integer NOT NULL,
    slot_datetime timestamp without time zone NOT NULL,
    duration_minutes integer DEFAULT 60,
    status public.slot_status DEFAULT 'available'::public.slot_status,
    capacity integer DEFAULT 1 NOT NULL,
    join_url text,
    zoom_meeting_id text,
    CONSTRAINT capacity_range CHECK (((capacity >= 1) AND (capacity <= 50))),
    CONSTRAINT check_capacity CHECK ((capacity > 0))
);


--
-- Name: teacher_availability_id_seq; Type: SEQUENCE; Schema: public; Owner: -
--

CREATE SEQUENCE public.teacher_availability_id_seq
    AS integer
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1;


--
-- Name: teacher_availability_id_seq; Type: SEQUENCE OWNED BY; Schema: public; Owner: -
--

ALTER SEQUENCE public.teacher_availability_id_seq OWNED BY public.teacher_availability.id;


--
-- Name: teacher_zoom; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.teacher_zoom (
    teacher_id integer NOT NULL,
    access_token text NOT NULL,
    refresh_token text NOT NULL,
    expires_at timestamp with time zone NOT NULL,
    connected_at timestamp with time zone DEFAULT now() NOT NULL
);


--
-- Name: teachers; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.teachers (
    user_id integer NOT NULL,
    title character varying(10),
    full_name character varying(100) NOT NULL,
    phone_number character varying(30),
    subject character varying(200),
    profile_picture_url character varying(500),
    photo text
);


--
-- Name: users; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.users (
    id integer NOT NULL,
    email character varying(100) NOT NULL,
    password character varying(200) NOT NULL,
    role public.user_role NOT NULL,
    created_at timestamp without time zone DEFAULT CURRENT_TIMESTAMP
);


--
-- Name: users_id_seq; Type: SEQUENCE; Schema: public; Owner: -
--

CREATE SEQUENCE public.users_id_seq
    AS integer
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1;


--
-- Name: users_id_seq; Type: SEQUENCE OWNED BY; Schema: public; Owner: -
--

ALTER SEQUENCE public.users_id_seq OWNED BY public.users.id;


--
-- Name: bookings id; Type: DEFAULT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.bookings ALTER COLUMN id SET DEFAULT nextval('public.bookings_id_seq'::regclass);


--
-- Name: password_resets id; Type: DEFAULT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.password_resets ALTER COLUMN id SET DEFAULT nextval('public.password_resets_id_seq'::regclass);


--
-- Name: teacher_availability id; Type: DEFAULT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.teacher_availability ALTER COLUMN id SET DEFAULT nextval('public.teacher_availability_id_seq'::regclass);


--
-- Name: users id; Type: DEFAULT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.users ALTER COLUMN id SET DEFAULT nextval('public.users_id_seq'::regclass);


--
-- Data for Name: bookings; Type: TABLE DATA; Schema: public; Owner: -
--

COPY public.bookings (id, student_id, availability_id, status, created_at) FROM stdin;
1	3	3	cancelled	2026-10-25 00:43:31.027637
\.


--
-- Data for Name: password_resets; Type: TABLE DATA; Schema: public; Owner: -
--

COPY public.password_resets (id, user_id, token_hash, expires_at, created_at) FROM stdin;
\.


--
-- Data for Name: students; Type: TABLE DATA; Schema: public; Owner: -
--

COPY public.students (user_id, f_name, l_name, phone_number) FROM stdin;
3	mazen	khaled	01207441122
\.


--
-- Data for Name: teacher_availability; Type: TABLE DATA; Schema: public; Owner: -
--

COPY public.teacher_availability (id, teacher_id, slot_datetime, duration_minutes, status, capacity, join_url, zoom_meeting_id) FROM stdin;
1	2	2026-10-19 14:55:00	120	cancelled	1	\N	\N
2	2	2026-10-19 17:05:00	120	available	1	\N	\N
3	2	2026-10-25 13:00:00	120	cancelled	1	https://us05web.zoom.us/j/84279700292?pwd=pqZwGIO5hzLr1nuXEXSDobO7jbhFtM.1	\N
4	2	2026-10-30 18:15:00	120	cancelled	5	https://us05web.zoom.us/j/89063715397?pwd=s06xNq47idXIaL3QF53UOGLVZBeyi5.1	89063715397
5	2	2026-10-27 16:20:00	120	cancelled	5	https://us05web.zoom.us/j/83170144795?pwd=NL2spGZSFWbFTlvsyr3kTxvUJSLPah.1	83170144795
\.


--
-- Data for Name: teacher_zoom; Type: TABLE DATA; Schema: public; Owner: -
--

COPY public.teacher_zoom (teacher_id, access_token, refresh_token, expires_at, connected_at) FROM stdin;
2	s3EVdUN9pbCrThqz.C4qiWvAOe1cJc2aB1CUxiQ==.bs5ApTckhguV2CDXK0T7kzJH39aHcLGAs9vvKsK8sPYSBx3I6i4akJ/mn6D5Fm7WKcOQ+2RL/HN1fqQeAh+qPjy8p/Tnq8DxJSPB89Ed2KG+oncPmm4CHWtPiiO3FNPt+vA924DglcfcOyQuexBX6A7n5oWzIElXE01Aq8giPSqXZR8zDCf6Tih46lXdiJgX89xRDldJAJ46SG/Eq2C2QvaEtUhii7gs3QqKSstZXtY+y3LdZ1S+wMaSRVZZvob0qb8Y5v/z/ywl6hwFqxgZpgvhzaOHLWKfN1oP7AZm7PN/DwXASljxCBtnJajx98YEcAL9uJvsH59ESQ6/IsH1ViOuxq44n1/4NiFS44fBl6uuMXbjrcgKMRIj0XRPSm8L4YfZMQiEyKpDZ0QgHxgz0YfWyxVXXBXEdNst4+ZXdHROSLwPuG5nCADR9b0NVwBOZlxDBYoa7eEjR+TgoByNge48pLmlW/Ui9ynEeIzSOJqijuN3eenF7zYLPKjx1bv855Xmqkt2ojFk1nPio9yPEBViZ7jtlndaX3QmzAiObdtltNMGD3z3TXmVo6fvK12gvmN+SctAPYxfQub3MlifKZ08hiLh8g8iYQC8PuwYo1PuMmk9TTGVtI8MyJMvyq41EGG58jeDc95un/c3qvDv4NYS4eR086lzBWizGUt617aaHtk+pE1/FBMRufvZGR1gGjb2jNplmSBjw/G1whjbprb4gyB1XpqP1vQ8vfyA2ACRv/C0mv5P9/bV3Bl9PvnpzpABs8F9c8yfCMWO3DYR9bvVmcDshCaUYr1t27TPSJ6eRpdyrEvhMnlIQyHIBp1o/oQvIyQ+SvBM9w==	m4evIzldFJZI2BbG.uH7/Okhgs62S7Sa/3KZaOw==.zzkcf3oemuhuYqKyoi53djwy6bfNMZub1vmgD5JKCCPNUv3dTB90s8qdrKW8Yc9GvfQUR4sSu1DY1Y+bu5HyIk+kaZvzzmmwNTKUP48U7Ex1AJs71wvMAWgWPLhe9SCV9REBzawTaGkrR+jF6SbndG1ivNLAdPjwtW/tJWaGmNxoapePpyb3IqX4lZz70Rdr7cViSVaAirDOasFP3XGiRoCgC+wbJiGdnMmxRPr4qSbnKrabDxSbBLJdAGmj262PwzDQr9JiZ7LoJqy9C9wQfeIjiAyQf7FTF7WStYn/MKOvF4ms4NzGGw0pwJt4R02gnLZzvLldfyGrvZgn8NJwjffuBfT8veicbT4at3yG20GlJphF4wm1mMWx+C6mPTnv4I84zF9QySbyfJ6hOsY1sra0gcghoN2EH+3tbeg8VhxaS2QWdcxEGm+6xFGfoO7Qpopydazuh1A97/WmCNlNjrlOr4E3KAv6Rgw8N2qtGSNYLOPEA+dg9A7BWHSQ5sJhQTLzD9elN81JVYWeYvkMMvoV73SYdkWY+P5PwwBm2Bvvz3cjel54Idf05xwbhwMl0J+rtRt88W1YIOKcDYcaz39A5DRonmd8VwIxC8OScYuamOG1+9NTYeuWUrwheZHEqVLzd+lFVYyWpz0JaGhzu4HH7ela8l3tbVhMFyI/9Dun9sjdZpiKm+Mhe4YHhJXfj1fr1JeLH+QHGR7bOuMrfmw3xa82qdvlklnjAvG0pJKwhrTaLiwDeO8L+95oIqaP1Khb0nprv2maptk54JUajDnnaLSWWIAVrjyePDP6CCosOxrS01xa55KUSiZGQx+CgZK855yCRLOjpQ==	2026-10-25 02:18:26.343054+03	2026-10-25 01:19:27.343054+03
\.


--
-- Data for Name: teachers; Type: TABLE DATA; Schema: public; Owner: -
--

COPY public.teachers (user_id, title, full_name, phone_number, subject, profile_picture_url, photo) FROM stdin;
4	أ/	بربري	0125358434	computer engineering	\N	\N
2	أ/	اكرم خالد	01207441122	science	\N	2-ab95deee26ed9982.jpg
\.


--
-- Data for Name: users; Type: TABLE DATA; Schema: public; Owner: -
--

COPY public.users (id, email, password, role, created_at) FROM stdin;
1	moderator@ta3lam.com	$2b$10$53dRrP6hi08zZ15sGXPNgutPcgcmse5onmcTwR68oUqeAu8bTPlKi	moderator	2026-10-19 02:31:28.633224
2	mazenyahoo0@gmail.com	$2b$10$d7ZZ.zTV2pMTVxG191PaE.E6/pPL.MYWtIBXQRXKfeXCLFbgJzoRu	teacher	2026-10-19 02:32:51.086722
3	wizardmizo190@gmail.com	$2b$10$5L0elkjgnEOGbMmawZWj3u/FEoqmNsN4eh9qsrTzcNc3Ek5E0d6na	student	2026-10-19 02:56:46.260336
4	mazenkhaled3856@gmail.com	$2b$10$js7ex1J6LNYEyC.fUm8LueTtBZr.u0SD0MuZuUXc20dPLLypf9i5.	teacher	2026-10-19 03:02:33.268811
\.


--
-- Name: bookings_id_seq; Type: SEQUENCE SET; Schema: public; Owner: -
--

SELECT pg_catalog.setval('public.bookings_id_seq', 1, true);


--
-- Name: password_resets_id_seq; Type: SEQUENCE SET; Schema: public; Owner: -
--

SELECT pg_catalog.setval('public.password_resets_id_seq', 1, false);


--
-- Name: teacher_availability_id_seq; Type: SEQUENCE SET; Schema: public; Owner: -
--

SELECT pg_catalog.setval('public.teacher_availability_id_seq', 5, true);


--
-- Name: users_id_seq; Type: SEQUENCE SET; Schema: public; Owner: -
--

SELECT pg_catalog.setval('public.users_id_seq', 4, true);


--
-- Name: bookings bookings_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.bookings
    ADD CONSTRAINT bookings_pkey PRIMARY KEY (id);


--
-- Name: password_resets password_resets_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.password_resets
    ADD CONSTRAINT password_resets_pkey PRIMARY KEY (id);


--
-- Name: password_resets password_resets_token_hash_key; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.password_resets
    ADD CONSTRAINT password_resets_token_hash_key UNIQUE (token_hash);


--
-- Name: session session_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.session
    ADD CONSTRAINT session_pkey PRIMARY KEY (sid);


--
-- Name: students students_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.students
    ADD CONSTRAINT students_pkey PRIMARY KEY (user_id);


--
-- Name: teacher_availability teacher_availability_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.teacher_availability
    ADD CONSTRAINT teacher_availability_pkey PRIMARY KEY (id);


--
-- Name: teacher_zoom teacher_zoom_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.teacher_zoom
    ADD CONSTRAINT teacher_zoom_pkey PRIMARY KEY (teacher_id);


--
-- Name: teachers teachers_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.teachers
    ADD CONSTRAINT teachers_pkey PRIMARY KEY (user_id);


--
-- Name: bookings unique_student_slot; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.bookings
    ADD CONSTRAINT unique_student_slot UNIQUE (student_id, availability_id);


--
-- Name: teacher_availability unique_teacher_slot; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.teacher_availability
    ADD CONSTRAINT unique_teacher_slot UNIQUE (teacher_id, slot_datetime);


--
-- Name: users users_email_key; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.users
    ADD CONSTRAINT users_email_key UNIQUE (email);


--
-- Name: users users_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.users
    ADD CONSTRAINT users_pkey PRIMARY KEY (id);


--
-- Name: IDX_session_expire; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX "IDX_session_expire" ON public.session USING btree (expire);


--
-- Name: one_active_booking_per_student; Type: INDEX; Schema: public; Owner: -
--

CREATE UNIQUE INDEX one_active_booking_per_student ON public.bookings USING btree (availability_id, student_id) WHERE (status = 'confirmed'::public.booking_status);


--
-- Name: one_moderator; Type: INDEX; Schema: public; Owner: -
--

CREATE UNIQUE INDEX one_moderator ON public.users USING btree (role) WHERE (role = 'moderator'::public.user_role);


--
-- Name: bookings bookings_availability_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.bookings
    ADD CONSTRAINT bookings_availability_id_fkey FOREIGN KEY (availability_id) REFERENCES public.teacher_availability(id) ON DELETE CASCADE;


--
-- Name: bookings bookings_student_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.bookings
    ADD CONSTRAINT bookings_student_id_fkey FOREIGN KEY (student_id) REFERENCES public.users(id) ON DELETE CASCADE;


--
-- Name: password_resets password_resets_user_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.password_resets
    ADD CONSTRAINT password_resets_user_id_fkey FOREIGN KEY (user_id) REFERENCES public.users(id) ON DELETE CASCADE;


--
-- Name: students students_user_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.students
    ADD CONSTRAINT students_user_id_fkey FOREIGN KEY (user_id) REFERENCES public.users(id);


--
-- Name: teacher_availability teacher_availability_teacher_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.teacher_availability
    ADD CONSTRAINT teacher_availability_teacher_id_fkey FOREIGN KEY (teacher_id) REFERENCES public.teachers(user_id) ON DELETE CASCADE;


--
-- Name: teacher_zoom teacher_zoom_teacher_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.teacher_zoom
    ADD CONSTRAINT teacher_zoom_teacher_id_fkey FOREIGN KEY (teacher_id) REFERENCES public.users(id) ON DELETE CASCADE;


--
-- Name: teachers teachers_user_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.teachers
    ADD CONSTRAINT teachers_user_id_fkey FOREIGN KEY (user_id) REFERENCES public.users(id);


--
-- PostgreSQL database dump complete
--

