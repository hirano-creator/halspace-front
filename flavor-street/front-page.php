<?php
/**
 * Template Name: トップページ
 * フロントページテンプレート
 *
 * @package FlavorStreet
 */

get_header();
?>

<main class="fs-main">

	<!-- ==============================
	     ヒーローセクション
	     ============================== -->
	<section class="fs-hero" id="top">
		<!-- 背景：動画 or 画像（カスタマイザーから設定可能） -->
		<div class="fs-hero__bg">
			<?php $hero_video = get_theme_mod( 'fs_hero_video' ); ?>
			<?php if ( $hero_video ) : ?>
				<video class="fs-hero__video" autoplay muted loop playsinline poster="<?php echo esc_url( fs_get_image( 'fs_hero_bg', 1920, 1080, 'HERO IMAGE' ) ); ?>">
					<source src="<?php echo esc_url( $hero_video ); ?>" type="video/mp4">
				</video>
			<?php else : ?>
				<div class="fs-hero__image" style="background-image: url('<?php echo esc_url( fs_get_image( 'fs_hero_bg', 1920, 1080, 'HERO IMAGE 1920x1080' ) ); ?>')"></div>
			<?php endif; ?>
			<div class="fs-hero__overlay"></div>
		</div>

		<div class="fs-hero__content fs-container">
			<p class="fs-hero__label">Kitchen Car Platform</p>
			<h1 class="fs-hero__title">
				<?php echo esc_html( get_theme_mod( 'fs_hero_title', 'キッチンカーの出展・誘致なら' ) ); ?>
				<span class="fs-hero__brand"><?php bloginfo( 'name' ); ?></span>
			</h1>
			<p class="fs-hero__subtitle">
				<?php echo esc_html( get_theme_mod( 'fs_hero_subtitle', '全国のキッチンカーと出展場所をつなぐプラットフォーム' ) ); ?>
			</p>
			<div class="fs-hero__buttons">
				<a href="<?php echo esc_url( home_url( '/exhibit/' ) ); ?>" class="fs-btn fs-btn--primary fs-btn--large">
					出展したい方はこちら
					<span class="fs-btn__arrow">&rarr;</span>
				</a>
				<a href="<?php echo esc_url( home_url( '/invite/' ) ); ?>" class="fs-btn fs-btn--accent fs-btn--large">
					誘致したい方はこちら
					<span class="fs-btn__arrow">&rarr;</span>
				</a>
			</div>
		</div>

		<!-- スクロールインジケーター -->
		<div class="fs-hero__scroll">
			<span>Scroll</span>
			<div class="fs-hero__scroll-line"></div>
		</div>
	</section>

	<!-- ==============================
	     サービス選択カード
	     ============================== -->
	<section class="fs-services fs-section" id="services">
		<div class="fs-container">
			<div class="fs-section-header">
				<span class="fs-section-header__en">Services</span>
				<h2 class="fs-section-header__title">あなたに合ったサービスを<br>お選びください</h2>
			</div>

			<div class="fs-services__grid">
				<!-- カード1: 出展場所を探す -->
				<a href="<?php echo esc_url( home_url( '/exhibit/' ) ); ?>" class="fs-service-card">
					<div class="fs-service-card__image">
						<!-- ★ 画像はカスタマイザーから差し替え可能 -->
						<img src="<?php echo esc_url( fs_get_image( 'fs_service_img_exhibit', 600, 400, '出展イメージ写真' ) ); ?>" alt="キッチンカーで出展したい" loading="lazy">
					</div>
					<div class="fs-service-card__body">
						<span class="fs-service-card__label">出展者向け</span>
						<h3 class="fs-service-card__title">キッチンカーで<br>出展したい</h3>
						<p class="fs-service-card__text">全国の出展スポットから最適な場所を見つけて、あなたのキッチンカーを出展しましょう。</p>
						<span class="fs-service-card__link">
							詳しく見る <span>&rarr;</span>
						</span>
					</div>
				</a>

				<!-- カード2: 開業支援 -->
				<a href="<?php echo esc_url( home_url( '/start/' ) ); ?>" class="fs-service-card">
					<div class="fs-service-card__image">
						<img src="<?php echo esc_url( fs_get_image( 'fs_service_img_start', 600, 400, '開業支援イメージ' ) ); ?>" alt="キッチンカーを始めたい" loading="lazy">
					</div>
					<div class="fs-service-card__body">
						<span class="fs-service-card__label">開業希望者向け</span>
						<h3 class="fs-service-card__title">キッチンカーを<br>始めたい</h3>
						<p class="fs-service-card__text">車両の準備から営業許可まで、キッチンカー開業をトータルサポートいたします。</p>
						<span class="fs-service-card__link">
							詳しく見る <span>&rarr;</span>
						</span>
					</div>
				</a>

				<!-- カード3: 空きスペースに呼ぶ -->
				<a href="<?php echo esc_url( home_url( '/invite/' ) ); ?>" class="fs-service-card">
					<div class="fs-service-card__image">
						<img src="<?php echo esc_url( fs_get_image( 'fs_service_img_invite', 600, 400, '誘致イメージ写真' ) ); ?>" alt="キッチンカーを呼びたい" loading="lazy">
					</div>
					<div class="fs-service-card__body">
						<span class="fs-service-card__label">施設オーナー向け</span>
						<h3 class="fs-service-card__title">キッチンカーを<br>呼びたい</h3>
						<p class="fs-service-card__text">空きスペースを活用してキッチンカーを誘致。導入費用ゼロで新たな価値を創出します。</p>
						<span class="fs-service-card__link">
							詳しく見る <span>&rarr;</span>
						</span>
					</div>
				</a>

				<!-- カード4: イベントに呼ぶ -->
				<a href="<?php echo esc_url( home_url( '/event/' ) ); ?>" class="fs-service-card">
					<div class="fs-service-card__image">
						<img src="<?php echo esc_url( fs_get_image( 'fs_service_img_event', 600, 400, 'イベントイメージ' ) ); ?>" alt="イベントにキッチンカーを呼びたい" loading="lazy">
					</div>
					<div class="fs-service-card__body">
						<span class="fs-service-card__label">イベント主催者向け</span>
						<h3 class="fs-service-card__title">イベントに<br>呼びたい</h3>
						<p class="fs-service-card__text">フェスや企業イベントに最適なキッチンカーをご提案。規模に合わせたプランニングが可能です。</p>
						<span class="fs-service-card__link">
							詳しく見る <span>&rarr;</span>
						</span>
					</div>
				</a>
			</div>
		</div>
	</section>

	<!-- ==============================
	     実績数値（トラクション）
	     ============================== -->
	<section class="fs-traction fs-section">
		<div class="fs-container">
			<div class="fs-traction__grid">
				<div class="fs-traction__item">
					<span class="fs-traction__number" data-count="<?php echo esc_attr( str_replace( ',', '', get_theme_mod( 'fs_traction_locations_num', '500' ) ) ); ?>">
						<?php echo esc_html( get_theme_mod( 'fs_traction_locations_num', '500' ) ); ?>
					</span>
					<span class="fs-traction__unit"><?php echo esc_html( get_theme_mod( 'fs_traction_locations_unit', 'ヶ所以上' ) ); ?></span>
					<span class="fs-traction__label">出展場所数</span>
				</div>
				<div class="fs-traction__item">
					<span class="fs-traction__number" data-count="<?php echo esc_attr( str_replace( ',', '', get_theme_mod( 'fs_traction_shops_num', '1000' ) ) ); ?>">
						<?php echo esc_html( get_theme_mod( 'fs_traction_shops_num', '1,000' ) ); ?>
					</span>
					<span class="fs-traction__unit"><?php echo esc_html( get_theme_mod( 'fs_traction_shops_unit', '店以上' ) ); ?></span>
					<span class="fs-traction__label">登録キッチンカー</span>
				</div>
				<div class="fs-traction__item">
					<span class="fs-traction__number" data-count="<?php echo esc_attr( str_replace( ',', '', get_theme_mod( 'fs_traction_events_num', '300' ) ) ); ?>">
						<?php echo esc_html( get_theme_mod( 'fs_traction_events_num', '300' ) ); ?>
					</span>
					<span class="fs-traction__unit"><?php echo esc_html( get_theme_mod( 'fs_traction_events_unit', '件以上' ) ); ?></span>
					<span class="fs-traction__label">イベント実績</span>
				</div>
				<div class="fs-traction__item">
					<span class="fs-traction__number" data-count="<?php echo esc_attr( str_replace( ',', '', get_theme_mod( 'fs_traction_satisfaction_num', '95' ) ) ); ?>">
						<?php echo esc_html( get_theme_mod( 'fs_traction_satisfaction_num', '95' ) ); ?>
					</span>
					<span class="fs-traction__unit"><?php echo esc_html( get_theme_mod( 'fs_traction_satisfaction_unit', '%' ) ); ?></span>
					<span class="fs-traction__label">利用者満足度</span>
				</div>
			</div>
		</div>
	</section>

	<!-- ==============================
	     こんな方におすすめ
	     ============================== -->
	<section class="fs-recommend fs-section fs-section--gray" id="about">
		<div class="fs-container">
			<div class="fs-section-header">
				<span class="fs-section-header__en">Who We Help</span>
				<h2 class="fs-section-header__title">こんな方におすすめです</h2>
			</div>

			<div class="fs-recommend__grid">
				<div class="fs-recommend__card">
					<div class="fs-recommend__icon">
						<svg width="48" height="48" viewBox="0 0 24 24" fill="none" stroke="var(--fs-primary)" stroke-width="1.5"><path d="M17 21v-2a4 4 0 0 0-4-4H5a4 4 0 0 0-4 4v2"/><circle cx="9" cy="7" r="4"/><path d="M23 21v-2a4 4 0 0 0-3-3.87"/><path d="M16 3.13a4 4 0 0 1 0 7.75"/></svg>
					</div>
					<h3 class="fs-recommend__title">出展場所を探している<br>キッチンカーオーナー</h3>
					<p class="fs-recommend__text">良い出展場所がなかなか見つからない、新しいエリアに進出したいとお考えの方に最適な場所をご紹介します。</p>
				</div>

				<div class="fs-recommend__card">
					<div class="fs-recommend__icon">
						<svg width="48" height="48" viewBox="0 0 24 24" fill="none" stroke="var(--fs-primary)" stroke-width="1.5"><rect x="2" y="3" width="20" height="14" rx="2"/><line x1="8" y1="21" x2="16" y2="21"/><line x1="12" y1="17" x2="12" y2="21"/><path d="M6 8h.01M9 8h.01"/></svg>
					</div>
					<h3 class="fs-recommend__title">空きスペースを<br>有効活用したいオーナー</h3>
					<p class="fs-recommend__text">オフィスビル、商業施設、マンション等の空きスペースにキッチンカーを誘致して、新たな収益源を作りませんか。</p>
				</div>

				<div class="fs-recommend__card">
					<div class="fs-recommend__icon">
						<svg width="48" height="48" viewBox="0 0 24 24" fill="none" stroke="var(--fs-primary)" stroke-width="1.5"><polygon points="12 2 15.09 8.26 22 9.27 17 14.14 18.18 21.02 12 17.77 5.82 21.02 7 14.14 2 9.27 8.91 8.26 12 2"/></svg>
					</div>
					<h3 class="fs-recommend__title">イベントを<br>盛り上げたい主催者</h3>
					<p class="fs-recommend__text">フェスティバル、企業イベント、地域のお祭りなど、あらゆるイベントにぴったりのキッチンカーをお手配します。</p>
				</div>
			</div>
		</div>
	</section>

	<!-- ==============================
	     サービスの流れ
	     ============================== -->
	<section class="fs-flow fs-section" id="flow">
		<div class="fs-container">
			<div class="fs-section-header">
				<span class="fs-section-header__en">How It Works</span>
				<h2 class="fs-section-header__title">ご利用の流れ</h2>
			</div>

			<!-- タブ切り替え -->
			<div class="fs-flow__tabs">
				<button class="fs-flow__tab is-active" data-tab="exhibit">出展したい方</button>
				<button class="fs-flow__tab" data-tab="invite">誘致したい方</button>
				<button class="fs-flow__tab" data-tab="event">イベント主催者</button>
			</div>

			<!-- 出展したい方の流れ -->
			<div class="fs-flow__content is-active" data-content="exhibit">
				<div class="fs-flow__steps">
					<div class="fs-flow__step">
						<div class="fs-flow__step-num">01</div>
						<div class="fs-flow__step-body">
							<h4>無料会員登録</h4>
							<p>簡単なフォーム入力で会員登録。最短3分で完了します。</p>
						</div>
					</div>
					<div class="fs-flow__step">
						<div class="fs-flow__step-num">02</div>
						<div class="fs-flow__step-body">
							<h4>出展場所を検索</h4>
							<p>エリア・条件から希望の出展場所を検索。空き状況もリアルタイムで確認できます。</p>
						</div>
					</div>
					<div class="fs-flow__step">
						<div class="fs-flow__step-num">03</div>
						<div class="fs-flow__step-body">
							<h4>出展申請</h4>
							<p>気になる場所が見つかったら出展申請。担当者が丁寧にサポートします。</p>
						</div>
					</div>
					<div class="fs-flow__step">
						<div class="fs-flow__step-num">04</div>
						<div class="fs-flow__step-body">
							<h4>出展開始</h4>
							<p>準備が整ったら出展スタート！売上向上のアドバイスも行います。</p>
						</div>
					</div>
				</div>
			</div>

			<!-- 誘致したい方の流れ -->
			<div class="fs-flow__content" data-content="invite">
				<div class="fs-flow__steps">
					<div class="fs-flow__step">
						<div class="fs-flow__step-num">01</div>
						<div class="fs-flow__step-body">
							<h4>お問い合わせ</h4>
							<p>フォームまたはお電話でお気軽にご相談ください。初回ヒアリングは無料です。</p>
						</div>
					</div>
					<div class="fs-flow__step">
						<div class="fs-flow__step-num">02</div>
						<div class="fs-flow__step-body">
							<h4>現地調査・プラン提案</h4>
							<p>スペースの確認と最適なキッチンカー運営プランをご提案します。</p>
						</div>
					</div>
					<div class="fs-flow__step">
						<div class="fs-flow__step-num">03</div>
						<div class="fs-flow__step-body">
							<h4>キッチンカー選定</h4>
							<p>ご要望に合わせて最適なキッチンカーをマッチングいたします。</p>
						</div>
					</div>
					<div class="fs-flow__step">
						<div class="fs-flow__step-num">04</div>
						<div class="fs-flow__step-body">
							<h4>運営開始</h4>
							<p>導入費用ゼロで運営スタート。継続的な運営サポートも行います。</p>
						</div>
					</div>
				</div>
			</div>

			<!-- イベント主催者の流れ -->
			<div class="fs-flow__content" data-content="event">
				<div class="fs-flow__steps">
					<div class="fs-flow__step">
						<div class="fs-flow__step-num">01</div>
						<div class="fs-flow__step-body">
							<h4>イベント内容のご相談</h4>
							<p>開催日時・場所・規模・ご予算をお聞かせください。</p>
						</div>
					</div>
					<div class="fs-flow__step">
						<div class="fs-flow__step-num">02</div>
						<div class="fs-flow__step-body">
							<h4>キッチンカーのご提案</h4>
							<p>イベントのテーマに合わせた最適なラインナップをご提案します。</p>
						</div>
					</div>
					<div class="fs-flow__step">
						<div class="fs-flow__step-num">03</div>
						<div class="fs-flow__step-body">
							<h4>事前準備・確認</h4>
							<p>当日のレイアウト・導線・必要設備の確認を行います。</p>
						</div>
					</div>
					<div class="fs-flow__step">
						<div class="fs-flow__step-num">04</div>
						<div class="fs-flow__step-body">
							<h4>イベント当日</h4>
							<p>当日のオペレーションもしっかりサポート。成功に導きます。</p>
						</div>
					</div>
				</div>
			</div>
		</div>
	</section>

	<!-- ==============================
	     実績ギャラリー
	     ============================== -->
	<section class="fs-gallery fs-section fs-section--gray" id="cases">
		<div class="fs-container">
			<div class="fs-section-header">
				<span class="fs-section-header__en">Cases</span>
				<h2 class="fs-section-header__title">導入実績</h2>
				<p class="fs-section-header__subtitle">全国各地で多くの実績があります</p>
			</div>

			<div class="fs-gallery__grid">
				<?php for ( $i = 1; $i <= 6; $i++ ) : ?>
					<?php
					$img     = get_theme_mod( "fs_gallery_img_{$i}" );
					$caption = get_theme_mod( "fs_gallery_caption_{$i}", '' );
					$src     = $img ? esc_url( $img ) : fs_placeholder_img( 800, 600, "実績写真 {$i}" );
					?>
					<div class="fs-gallery__item">
						<div class="fs-gallery__image">
							<!-- ★ 写真はカスタマイザーから差し替え可能 -->
							<img src="<?php echo $src; ?>" alt="<?php echo esc_attr( $caption ?: "導入実績 {$i}" ); ?>" loading="lazy">
						</div>
						<?php if ( $caption ) : ?>
							<p class="fs-gallery__caption"><?php echo esc_html( $caption ); ?></p>
						<?php endif; ?>
					</div>
				<?php endfor; ?>
			</div>

			<div class="fs-gallery__more">
				<a href="<?php echo esc_url( home_url( '/cases/' ) ); ?>" class="fs-btn fs-btn--secondary">
					実績をもっと見る
					<span class="fs-btn__arrow">&rarr;</span>
				</a>
			</div>
		</div>
	</section>

	<!-- ==============================
	     ニュース
	     ============================== -->
	<section class="fs-news fs-section" id="news">
		<div class="fs-container">
			<div class="fs-section-header">
				<span class="fs-section-header__en">News</span>
				<h2 class="fs-section-header__title">ニュース</h2>
			</div>

			<div class="fs-news__list">
				<?php
				$news_query = new WP_Query( array(
					'post_type'      => 'fs_news',
					'posts_per_page' => 5,
					'orderby'        => 'date',
					'order'          => 'DESC',
				) );

				if ( $news_query->have_posts() ) :
					while ( $news_query->have_posts() ) :
						$news_query->the_post();
				?>
					<a href="<?php the_permalink(); ?>" class="fs-news__item">
						<time class="fs-news__date" datetime="<?php echo get_the_date( 'Y-m-d' ); ?>">
							<?php echo get_the_date( 'Y.m.d' ); ?>
						</time>
						<?php
						$terms = get_the_terms( get_the_ID(), 'fs_news_cat' );
						if ( $terms && ! is_wp_error( $terms ) ) :
						?>
							<span class="fs-news__category"><?php echo esc_html( $terms[0]->name ); ?></span>
						<?php endif; ?>
						<span class="fs-news__title"><?php the_title(); ?></span>
					</a>
				<?php
					endwhile;
					wp_reset_postdata();
				else :
				?>
					<div class="fs-news__item fs-news__item--placeholder">
						<time class="fs-news__date">----.--.--</time>
						<span class="fs-news__category">お知らせ</span>
						<span class="fs-news__title">ニュースはまだありません</span>
					</div>
				<?php endif; ?>
			</div>

			<div class="fs-news__more">
				<a href="<?php echo esc_url( home_url( '/news/' ) ); ?>" class="fs-btn fs-btn--secondary">
					ニュース一覧
					<span class="fs-btn__arrow">&rarr;</span>
				</a>
			</div>
		</div>
	</section>

	<!-- ==============================
	     メディア掲載（信頼性）
	     ============================== -->
	<section class="fs-media fs-section fs-section--gray">
		<div class="fs-container">
			<div class="fs-section-header">
				<span class="fs-section-header__en">Media</span>
				<h2 class="fs-section-header__title">メディア掲載</h2>
			</div>
			<div class="fs-media__logos">
				<!-- ★ メディアロゴは管理画面から差し替え -->
				<!-- プレースホルダーとして空のスロットを6つ用意 -->
				<?php for ( $i = 1; $i <= 6; $i++ ) : ?>
					<div class="fs-media__logo">
						<img src="<?php echo fs_placeholder_img( 200, 60, "Media {$i}" ); ?>" alt="メディア掲載 <?php echo $i; ?>" loading="lazy">
					</div>
				<?php endfor; ?>
			</div>
		</div>
	</section>

</main>

<?php get_footer(); ?>
