from flask import Flask, request, jsonify
from flask_cors import CORS
from waitress import serve

import db

app = Flask(__name__)
CORS(app)


@app.route('/explosions', methods=['GET'])
def get_explosive_branches():
    try:
        start = request.args.get('start', type=int)
        end = request.args.get('end', type=int)
        min_sons = request.args.get('min_sons', type=int)
        t_window = request.args.get('t_window', type=int)
        min_hex = request.args.get('min_hex', type=int)
        min_hex_son = request.args.get('min_hex_son', type=int)
        min_grandsons = request.args.get('min_grandsons', type=int, default=0)

        size = request.args.get('size', '3')

        required = [start, end, min_sons, t_window, min_hex, min_hex_son, min_grandsons]
        if any(v is None for v in required):
            return jsonify({"error": "Missing required filters"}), 400

        parent_snp = request.args.get('parent_snp')

        h3_indices_raw = request.args.get('h3_indices')
        h3_list = None
        if h3_indices_raw:
            h3_list = [h.strip() for h in h3_indices_raw.split(',') if h.strip()]

        print(f"yExplosion Query: TMRCA {start}:{end}, Window {t_window}, Parent: {parent_snp}")

        results = db.select_brancher_data(
            start=start,
            end=end,
            min_sons=min_sons,
            size=size,
            t_window=t_window,
            min_hex=min_hex,
            min_hex_son=min_hex_son,
            h3_list=h3_list,
            parent_snp=parent_snp,
            min_grandsons=min_grandsons
        )

        return jsonify(results)

    except Exception as e:
        print(f"API Error: {e}")
        return jsonify({"error": str(e)}), 500


@app.teardown_appcontext
def shutdown_session(exception=None):
    db.Session.remove()


if __name__ == '__main__':
    print('yExplosion ready!')
    try:
        serve(app,
              host='0.0.0.0',
              port=8080)
    except (KeyboardInterrupt, SystemExit):
        print("Stopping yExplosion...")
    finally:
        print("Closing YDB resources...")
        db.stop_pool()
        print('yExplosion stopped.')
