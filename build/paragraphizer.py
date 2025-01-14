#!/usr/bin/env python3
# -*- coding: utf-8 -*-

# paragraphizer.py: reformat a single paragraph into multiple paragraphs using GPT-3 neural nets
# Author: Gwern Branwen
# Date: 2022-02-18
# When:  Time-stamp: "2023-05-28 21:46:48 gwern"
# License: CC-0
#
# Usage: $ OPENAI_API_KEY="sk-XXX" xclip -o | python paragraphizer.py
#
# Paragraphizer attempts to reformat a single run-on paragraph into multiple shorter paragraphs,
# presumably split by topic. This is particularly useful for research paper abstracts, which are
# usually written in a sequential fashion (along the lines of 'Background / Question / Data /
# Methods / Results / Conclusion') but not always formatted in topic-separated paragraphs. A
# jargon-heavy run-on abstract can be near-impossible to skim.
#
# Paragraphizer does this by a call to the OA API; I have found that a simple 'rewrite this as'
# zero-shot prompt works well with davinci-instruct models (and is unreliable with smaller models or
# plain davinci). The main failure mode is that it will not copy the abstract exactly, and may
# reword or expand on parts, which is highly undesirable, and would mean that it cannot be used to
# automatically reformat abstracts. (And if you aren't going to use Paragraphizer automatically, why
# bother? It doesn't take long to add linebreaks by hand.) That failure mode can be removed by
# simply checking that after removing the new newlines, it equals the original input (ie. the *only*
# difference is the inserted newlines). The result can still be bad but it's probably at least
# better.
#
# WARNING: Newlines must be absent. GPT-3 remains quite fragile in dealing with Unicode and HTML [see OA docs]:
# remove as much special formatting as possible like Unicode characters such as NON-BREAKING SPACE
# or HTML tags like `<p>` or HTML entities like `&amp;`. GPT-3 will either give up and do nothing,
# or mangle it (thereby failing the check & emitting the original input, wasting a call).
#
# Example:
#
# $ xclip -o
# Most deep reinforcement learning (RL) algorithms distill experience into parametric behavior
# policies or value functions via gradient updates. While effective, this approach has several
# disadvantages: (1) it is computationally expensive, (2) it can take many updates to integrate
# experiences into the parametric model, (3) experiences that are not fully integrated do not
# appropriately influence the agent's behavior, and (4) behavior is limited by the capacity of the
# model. In this paper we explore an alternative paradigm in which we train a network to map a
# dataset of past experiences to optimal behavior. Specifically, we augment an RL agent with a
# retrieval process (parameterized as a neural network) that has direct access to a dataset of
# experiences. This dataset can come from the agent's past experiences, expert demonstrations, or
# any other relevant source. The retrieval process is trained to retrieve information from the
# dataset that may be useful in the current context, to help the agent achieve its goal faster and
# more efficiently. We integrate our method into two different RL agents: an offline DQN agent and
# an online R2D2 agent. In offline multi-task problems, we show that the retrieval-augmented DQN
# agent avoids task interference and learns faster than the baseline DQN agent. On Atari, we show
# that retrieval-augmented R2D2 learns significantly faster than the baseline R2D2 agent and
# achieves higher scores. We run extensive ablations to measure the contributions of the components
# of our proposed method.
# $ OPENAI_API_KEY="sk-XYZ" xclip -o | python paragraphizer.py
# Most deep reinforcement learning (RL) algorithms distill experience into parametric behavior
# policies or value functions via gradient updates. While effective, this approach has several
# disadvantages: (1) it is computationally expensive, (2) it can take many updates to integrate
# experiences into the parametric model, (3) experiences that are not fully integrated do not
# appropriately influence the agent's behavior, and (4) behavior is limited by the capacity of the
# model.
#
# In this paper we explore an alternative paradigm in which we train a network to map a dataset of
# past experiences to optimal behavior. Specifically, we augment an RL agent with a retrieval
# process (parameterized as a neural network) that has direct access to a dataset of experiences.
# This dataset can come from the agent's past experiences, expert demonstrations, or any other
# relevant source. The retrieval process is trained to retrieve information from the dataset that
# may be useful in the current context, to help the agent achieve its goal faster and more
# efficiently.
#
# We integrate our method into two different RL agents: an offline DQN agent and an online R2D2
# agent. In offline multi-task problems, we show that the retrieval-augmented DQN agent avoids task
# interference and learns faster than the baseline DQN agent. On Atari, we show that
# retrieval-augmented R2D2 learns significantly faster than the baseline R2D2 agent and achieves
# higher scores. We run extensive ablations to measure the contributions of the components of our
# proposed method.

import signal
import sys
import openai

# define timeout handling:
def handler(signum, frame):
    raise TimeoutError("Function call timed out")

# define function to run with timeout:
def run_with_timeout(func_name, args=(), kwargs={}, timeout=5):
    func = getattr(openai.ChatCompletion, func_name)
    signal.signal(signal.SIGALRM, handler)
    signal.alarm(timeout)
    try:
        result = func(*args, **kwargs)
    except TimeoutError as e:
        result = None
    finally:
        signal.alarm(0)
    return result

if len(sys.argv) == 1:
    target = sys.stdin.read().strip()
else:
    target = sys.argv[1]

messages = [
    {"role": "system", "content": "You are a helpful assistant that adds hyperlinks to text, and adds double-newlines to split abstracts into paragraphs (one topic per paragraph.)"},
    {"role": "user", "content": f"Please process the following abstract (between the '<abstract>' and '</abstract>' tags), by adding double-newlines to split it into paragraphs (one topic per paragraph.) Use American spelling & conventions. Please also add useful hyperlinks (such as Wikipedia articles) in HTML format to technical terminology or names; do not duplicate links: include each link ONLY once. Please include ONLY the resulting text with hyperlinks in your output, include ALL the original text, and include NO other conversation or comments.\n\n<abstract>\n{target}\n</abstract>"}
]

result = run_with_timeout(
    "create",
    kwargs={
        "model": "gpt-4",
        # "model": "gpt-3.5-turbo",
        "messages": messages,
        # "max_tokens": 4090,
        "temperature": 0
    },
    timeout=120
)

if result is None:
                          sys.stderr.write("Function call timed out")
else:
                          print(result['choices'][0]['message']['content'])

# print(result)
# if target == (result.replace('\n', '')).replace(' ', ''):
#     print(result)
# else:
#     sys.stderr.write(result+'\n-----------------------------------------\n')
#     print("mangled")
